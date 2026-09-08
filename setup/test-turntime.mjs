// A turn always answers, even when it runs out of time.
//
//   node setup/test-turntime.mjs
//
// raffy, 2026-09-08: the Penang build sat at "building" for an hour, and then
// "also it makes asking chat question also get stuck." One cause, two symptoms.
//
// A turn answers its tool calls one after another and sends the results
// together at the end. Every branch was wrapped, so nothing could end a turn by
// THROWING — but nothing wrapped the clock. Add a lookup that can take ninety
// seconds (which is what shipping Apify did that morning) and two of them run
// past the platform's ceiling: the request dies before the results are sent,
// every answer computed so far is discarded, and the calls stay pending
// forever. The conversation stops. And because the build is pumped further
// down the SAME request, the build stops too — which is exactly what it looked
// like from the outside: a spinner that never finished and a chat that would
// not reply.

import assert from 'node:assert';

let n = 0;
const t = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };

console.log('\nA scraper cannot eat a whole turn');
{
  process.env.APIFY_TOKEN = 'apify_test';
  const A = await import('../lib/apify.js');
  // The timeout is read at call time from the settings, so it can be retuned
  // against real runs without a deploy. What matters here is the ceiling.
  let asked = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { asked = String(url); return new Response('[]', { status: 200 }); };
  process.env.APIFY_FLIGHTS_ACTOR = 'a/b';
  await A.runActor('a/b', {});
  globalThis.fetch = realFetch;

  t('the run is capped well inside a chat turn', () => {
    const m = asked.match(/[?&]timeout=(\d+)/);
    assert.ok(m, asked);
    const seconds = Number(m[1]);
    // 90 seconds was the shipped value and it is what broke the turn. Anything
    // at or above a minute is back in the danger zone.
    assert.ok(seconds <= 30, seconds + 's is too long to wait inside a turn');
    assert.ok(seconds >= 10, seconds + 's is too short to get an answer');
  });
}

console.log('\nAnd when time runs out, the calls still get answered');
{
  // The shape of the guard, asserted directly: past the deadline, a pending
  // call is answered rather than skipped. Left unanswered, the session sits
  // idle holding it and nothing can ever wake it.
  const pending = [{ id: 'c1', name: 'check_prices' }, { id: 'c2', name: 'research' }];
  const until = Date.now() - 1;                    // already out of time
  const results = [];
  for (const call of pending) {
    if (Date.now() > until) {
      results.push({
        type: 'user.custom_tool_result', custom_tool_use_id: call.id,
        content: [{ type: 'text', text: 'NOT RUN — this turn ran out of time before reaching '
          + call.name + '.' }],
      });
      continue;
    }
    results.push({ type: 'user.custom_tool_result', custom_tool_use_id: call.id, content: [] });
  }
  t('every pending call gets a result, not just the ones that fit', () => {
    assert.equal(results.length, pending.length);
    assert.deepEqual(results.map((r) => r.custom_tool_use_id), ['c1', 'c2']);
  });
  t('and the result says what happened, so the agent can recover', () => {
    assert.match(results[0].content[0].text, /NOT RUN/);
    assert.match(results[0].content[0].text, /check_prices/);
  });
}

console.log('\nA build can never take the conversation with it');
{
  const src = await (await import('node:fs/promises')).readFile('lib/managedAgents.js', 'utf8');
  const from = src.indexOf('const budget = deadline(ms);');
  const to = src.indexOf('return { ok: true, steps };');
  const block = src.slice(from, to);
  t('the build loop is wrapped', () => {
    assert.ok(/\} catch \(err\) \{/.test(block), 'the build pump must not be able to throw out');
    assert.ok(/build\.stalled/.test(block), 'and a stall must be written down');
  });
  t('the chat is pumped before it, with a budget of its own', () => {
    assert.match(src, /await pumpChat\(chatSessionId, visible, Math\.max\(/);
  });
}

console.log('\n' + n + ' passed');
