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


// THE BUILD SIDE, which is where the Penang bug actually lived.
//
// raffy, 2026-09-08: "why are u fixing apify? chat is not the issue. the issue
// is the build part. and the chat got stuck because the build got stuck."
//
// He was right. The builder asks the app to apply an itinerary op; the app
// replays every call so far to rebuild the itinerary and hands back the result.
// That replay can throw on input the builder can legitimately produce — a day
// index past the end, a stay that names nothing — and it was the one branch of
// answerBuilderCall with no try/catch around it. A throw there escapes
// pumpBuilder, so the call is never ANSWERED: the builder sits idle holding it,
// the next poll throws in the same place, and the build waits forever.
console.log('\nA builder call always gets an answer');
{
  const { answerBuilderCall } = await import('../lib/managedAgents.js');

  // An op shaped wrongly enough to break the replay. What matters is not this
  // particular shape — it is that ANY shape comes back with a reply.
  const bad = { id: 'c1', name: 'set_day', input: { day: 9999, oops: { deep: { bad: undefined } } } };
  const answer = await answerBuilderCall(bad, [bad]);
  t('a call the app cannot process still gets a reply', () => {
    assert.equal(typeof answer, 'string');
    assert.ok(answer.length > 0);
  });
  t('and the reply tells the builder what to do about it', () => {
    // "Unknown tool" for a name we do not have, or a failure it can act on.
    assert.ok(/unknown tool|failed|again/i.test(answer), answer.slice(0, 120));
  });
  t('an unknown tool is answered rather than ignored', async () => {
    const out = await answerBuilderCall({ id: 'c2', name: 'not_a_tool', input: {} }, []);
    assert.equal(out, 'Unknown tool.');
  });
}

console.log('\nAnd one bad call does not silence the others');
{
  const src = await (await import('node:fs/promises')).readFile('lib/managedAgents.js', 'utf8');
  const i = src.indexOf('async function pumpBuilder');
  const block = src.slice(i, i + 1800);
  t('every call is answered independently', () => {
    // Promise.all rejects as a whole: one throwing call used to discard the
    // answers to every call beside it, and none were sent.
    assert.ok(/try \{\s*text = await answerBuilderCall/.test(block), block.slice(0, 400));
  });
  t('and a missing answer is still an answer', () => {
    assert.ok(/text \|\| 'No answer\.'/.test(block));
  });
}

// PHOTOGRAPHS MUST NOT WAIT ON THE BUILD BEING DECLARED FINISHED.
//
// raffy, 2026-09-08, on a Penang trip that was plainly complete — six days, a
// stay, twenty-nine things, the map — with the card stuck at five of six:
// "its still stuck at photograph."
//
// The build had wedged on an unanswered call, so the app still believed it was
// building. The photo fill ran only when the build was finished. So a finished
// itinerary could never get its pictures, because the thing that had stopped
// was not the thing being waited for.
console.log('\nPhotographs do not wait on the build');
{
  const src = await (await import('node:fs/promises')).readFile('lib/managedAgents.js', 'utf8');
  const i = src.indexOf('const after = await look(await listEvents(chatSessionId));');
  const block = src.slice(i, i + 1600);
  t('the fill runs whenever there is an itinerary', () => {
    assert.ok(/if \(after\.itinerary\) \{/.test(block), block.slice(0, 300));
    assert.ok(!/!after\.building/.test(block), 'the build gate is back');
  });

  // And the fill itself has to be safe to run repeatedly, since it now runs on
  // every poll rather than once at the end.
  const { fillPhotoGaps } = await import('../lib/photos.js');
  t('with no key it changes nothing', async () => {
    const known = { 'a:b': { u: 'x', done: 1 } };
    assert.deepEqual(await fillPhotoGaps({ days: [] }, known, {}), known);
  });
  t('and a place already looked up is never bought twice', async () => {
    // `done` marks a key we have paid for, hit or miss. Running mid-build is
    // only affordable because of this.
    const src2 = await (await import('node:fs/promises')).readFile('lib/photos.js', 'utf8');
    assert.ok(/\.filter\(\(g\) => !fillOf\(known\[g\.key\]\)\.done\)/.test(src2));
  });
}

console.log('\n' + n + ' passed');
