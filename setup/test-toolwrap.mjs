// A tool handler must never be able to kill a turn.
//
// raffy's Kundasang trip, 2026-09-05: the chat stopped replying after "Yes
// total 3 nights". The research branch used the wrong variable name for the
// session, and the reference sat outside that branch's try/catch — so a
// ReferenceError escaped the dispatch loop, the tool result was never sent,
// and the session sat idle holding a pending call that nothing could answer.
//
// The typo is fixed. This is about the shape: whatever a handler does, the call
// gets an answer. A bad answer is a bad turn; no answer is a dead conversation.
//
//   node setup/test-toolwrap.mjs

process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.OPENROUTER_API_KEY = 'sk-or-test';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const SESSION = 'sesn_' + 'w'.repeat(20);
let events = [];
let sent = [];
let deskWorks = false;

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/events') && (opts.method || 'GET') === 'GET') {
    return new Response(JSON.stringify({ data: events }), { status: 200 });
  }
  if (u.includes('/events')) {
    const body = JSON.parse(opts.body || '{}');
    sent.push(...(body.events || []));
    return new Response('{}', { status: 200 });
  }
  if (u.includes('openrouter.ai')) {
    if (deskWorks) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Kinabalu Park is the anchor. RM50 entry.' } }],
        model: 'deepseek/deepseek-chat-v3-0324',
        usage: { prompt_tokens: 900, completion_tokens: 120, cost: 0.007 },
      }), { status: 200 });
    }
    // Whatever the desk does, it must not take the turn down with it.
    throw new Error('network exploded');
  }
  if (u.includes('oauth2.googleapis.com')) {
    return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
  }
  return realFetch(url, opts);
};

const M = await import('../lib/managedAgents.js');

const call = (name, input, id) => ({ id, type: 'agent.custom_tool_use', name, input });

console.log('\na handler that blows up');

events = [
  { type: 'user.message', content: [{ type: 'text', text: 'hi' }] },
  call('research', { questions: ['what is there to do in Kundasang?'] }, 'c1'),
];
sent = [];
let threw = false;
try { await M.advanceState(SESSION, 2000); } catch (e) { threw = true; }

const answers = sent.filter((e) => e.type === 'user.custom_tool_result');
ok('the turn does not throw out of the dispatcher', !threw);
ok('the call is answered anyway', answers.some((a) => a.custom_tool_use_id === 'c1'),
   answers.length + ' result(s) sent');
ok('and the answer tells the agent what to say',
   /could not|failed/i.test(JSON.stringify(answers)));

console.log('\nseveral calls, one of them bad');

events = [
  { type: 'user.message', content: [{ type: 'text', text: 'hi' }] },
  call('read_itinerary', {}, 'a1'),
  call('research', { questions: ['boom'] }, 'a2'),
  call('note_plan', { destination: 'Kundasang' }, 'a3'),
];
sent = [];
await M.advanceState(SESSION, 2000).catch(() => {});
const got = new Set(sent.filter((e) => e.type === 'user.custom_tool_result')
  .map((e) => e.custom_tool_use_id));
ok('every call gets a result, not just the ones before the bad one',
   got.has('a1') && got.has('a2') && got.has('a3'),
   [...got].join(', '));

console.log('\nan unknown tool');
events = [
  { type: 'user.message', content: [{ type: 'text', text: 'hi' }] },
  call('teleport', {}, 'z1'),
];
sent = [];
await M.advanceState(SESSION, 2000).catch(() => {});
ok('is answered rather than ignored',
   sent.some((e) => e.custom_tool_use_id === 'z1'));


console.log('\na research round that WORKS');

// The test that actually catches the Kundasang bug. The wrap above answers the
// call either way, so it cannot tell a working desk from a broken one — this
// can: with the wrong session variable the ReferenceError fires AFTER the
// research succeeds, the wrap swallows it, and the traveller gets the generic
// failure line instead of the answer that was already paid for.
deskWorks = true;
events = [
  { type: 'user.message', content: [{ type: 'text', text: 'hi' }] },
  call('research', { questions: ['what is there to do in Kundasang?'] }, 'r1'),
];
sent = [];
await M.advanceState(SESSION, 2000).catch(() => {});
const r = sent.find((e) => e.custom_tool_use_id === 'r1');
const body = r ? JSON.stringify(r.content) : '';
ok('the researched answer reaches the agent', /Kinabalu Park is the anchor/.test(body),
   body.slice(0, 90));
ok('and NOT the generic failure line', !/failed unexpectedly/i.test(body));
deskWorks = false;

console.log(fail ? '\n' + fail + ' FAILED\n' : '\nall passed\n');
process.exit(fail ? 1 : 0);
