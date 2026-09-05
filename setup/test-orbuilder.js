// The builder running on OpenRouter, with the model stubbed.
//
// OpenRouter is unreachable from this sandbox (403 at the egress proxy), so
// the network is faked — but everything that actually breaks in a port like
// this is local: the tool-shape conversion, parsing arguments a different
// model escapes differently, folding tool results into the itinerary, and
// knowing when to stop.

import crypto from 'crypto';
import { TOOLS } from '../lib/schema.js';
import { FIND_TOOL } from '../lib/photos.js';

let fail = 0;
const check = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

process.env.OPENROUTER_API_KEY = 'sk-or-test';

// A throwaway key, because the Firestore client signs a JWT before it will
// talk to anything — including the stub below.
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'p', client_email: 'a@b.c', private_key: privateKey,
});

// A Firestore stand-in, so the state machine is exercised without the network.
const DOCS = new Map();
const fs = await import('../lib/firestore.js');
const or = await import('../lib/orBuilder.js');

// --- the shape handed to the model ---------------------------------------
const names = TOOLS.map((t) => t.name);
check('every itinerary tool is offered', names.includes('save_itinerary') && names.includes('add_photos'));
check('and so is photo search', FIND_TOOL.name === 'find_photos');
check('the model id is the one he asked for', or.MODEL() === 'deepseek/deepseek-chat-v3-0324');
process.env.OPENROUTER_MODEL = 'z-ai/glm-5.3-flash';
check('and it can be changed without a code change', or.MODEL() === 'z-ai/glm-5.3-flash');
delete process.env.OPENROUTER_MODEL;

// --- the loop -------------------------------------------------------------
const ITIN = {
  trip: { id: 'dn', title: 'Da Nang', who: 'Aisyah' },
  stays: [{ n: 'Furama' }],
  days: [{ dow: 'Thu', dom: '10', title: 'Arrive', items: [{ t: '9:15am', h: 'Land' }] }],
  ideas: [], areas: [],
};

let turns = [];
let seen = [];
const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://firestore.googleapis.com')) {
    const id = decodeURIComponent(u.split('/builds/')[1].split('?')[0]);
    if (opts.method === 'PATCH') {
      DOCS.set(id, JSON.parse(opts.body).fields);
      return { ok: true, status: 200, headers: new Headers(), text: async () => '{}' };
    }
    const f = DOCS.get(id);
    return f
      ? { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ fields: f }) }
      : { ok: true, status: 404, headers: new Headers(), text: async () => '' };
  }
  if (u.startsWith('https://oauth2.googleapis.com')) {
    return { ok: true, headers: new Headers(), json: async () => ({ access_token: 't', expires_in: 3600 }) };
  }
  if (u.startsWith('https://openrouter.ai')) {
    const body = JSON.parse(opts.body);
    seen.push(body);
    const next = turns.shift();
    if (next && next.throw) return { ok: false, status: 500, text: async () => 'upstream boom' };
    return { ok: true, status: 200, text: async () => JSON.stringify({
      choices: [{ message: next.message, finish_reason: next.message.tool_calls ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    }) };
  }
  return realFetch(url, opts);
};

const tc = (name, args, id = 'c' + Math.random().toString(36).slice(2, 6)) =>
  ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });

// Which builder runs is a setting now, not a constant — raffy, 2026-09-05:
// "switch to sonnet for now and openrouter v3." The environment still wins, so
// these two lines are the switch in both directions.
process.env.BUILDER = 'managed';
check('it is off when the setting says managed', !(await or.orBuilderReady()));
process.env.BUILDER = 'openrouter';
check('and ready once it is, with a key and a store', await or.orBuilderReady());
check('the model defaults to DeepSeek v3', /^deepseek\//.test(or.MODEL()));

// A normal build: save, then photos, then stop.
turns = [
  { message: { role: 'assistant', content: '', tool_calls: [tc('save_itinerary', ITIN)] } },
  { message: { role: 'assistant', content: '', tool_calls: [tc('find_photos', { queries: [{ key: 'x', search: 'nothing' }] })] } },
  { message: { role: 'assistant', content: 'Done.' } },
];
const id = await or.startBuild('Build the itinerary for this trip.\n\nDestination: Da Nang');
check('the brief is the first thing the model sees',
  JSON.parse(DOCS.get(id).messages.stringValue)[1].content.includes('Da Nang'));
check('and it is told it has no web search',
  JSON.parse(DOCS.get(id).messages.stringValue)[0].content.includes('NO web search'));

let r = await or.advanceBuild(id);
check('the first call builds the itinerary', !!r.itinerary && r.itinerary.days.length === 1);
check('and it says it is still going', r.building === true);
check('the tools are sent in the shape OpenRouter wants',
  seen[0].tools.every((t) => t.type === 'function' && !!t.function.parameters));

r = await or.advanceBuild(id);
check('a photo search is answered rather than crashing on', r.building === true);
check('the tool result is stored against its call id',
  JSON.parse(DOCS.get(id).messages.stringValue).some((m) => m.role === 'tool' && !!m.tool_call_id));

r = await or.advanceBuild(id);
check('it finishes when the model stops calling tools', r.building === false);
check('and the itinerary survives to the end', r.itinerary.trip.title === 'Da Nang');
check('a finished build is not run again',
  (await or.advanceBuild(id)).building === false && seen.length === 3);

// --- the three ways a real build went wrong ---------------------------------
//
// raffy, 2026-09-05: "it's taking really really really long now. not like
// before. and days wrong. 7 days can become 1. photos missing. no photo at all."
//
// All three are in the build records, and none of them was a slow model.
{
  seen = [];
  const seven = { ...ITIN, days: Array.from({ length: 7 }, (_, i) => ({ ...ITIN.days[0], title: 'Day ' + i })) };

  // 1. save_itinerary REPLACES the trip, and one real build called it three
  //    times. The last one wins, so a seven-day trip became whatever the model
  //    could still remember by then.
  turns = [
    { message: { role: 'assistant', content: '', tool_calls: [tc('save_itinerary', seven)] } },
    { message: { role: 'assistant', content: '', tool_calls: [
      tc('save_itinerary', { ...seven, days: [seven.days[0]] }, 'shrink')] } },
    { message: { role: 'assistant', content: 'Done.' } },
  ];
  const sid = await or.startBuild('Build it.');
  const first = await or.advanceBuild(sid);
  check('a seven-day trip saves as seven days', first.itinerary.days.length === 7);
  const after = await or.advanceBuild(sid);
  check('and a second, shorter save cannot delete six of them',
    after.itinerary.days.length === 7, after.itinerary.days.length + ' days');
  const told = JSON.parse(DOCS.get(sid).messages.stringValue)
    .filter((m) => m.role === 'tool' && m.tool_call_id === 'shrink')[0];
  check('the builder is told why, so it stops trying',
    /Not applied/.test(told.content) && /update_day/.test(told.content),
    (told.content || '').slice(0, 60));
  // Growing is a builder that thought of more, and must still work.
  turns = [{ message: { role: 'assistant', content: '', tool_calls: [
    tc('save_itinerary', { ...seven, days: seven.days.concat([{ ...ITIN.days[0], title: 'Day 8' }]) })] } }];
  const grown = await or.advanceBuild(sid);
  check('but a longer save still goes through', grown.itinerary.days.length === 8,
    grown.itinerary.days.length + ' days');
}

{
  // 2. Eight replies with no text and no tool call, pushed back eight times for
  //    an itinerary that was never coming. That is the "really really long".
  seen = [];
  turns = Array.from({ length: 6 }, () => ({ message: { role: 'assistant', content: '' } }));
  const eid = await or.startBuild('Build it.');
  let last = null, polls = 0;
  for (let i = 0; i < 6; i++) {
    last = await or.advanceBuild(eid);
    polls++;
    if (!last.building) break;
  }
  check('an empty answer is not mistaken for prose', polls <= 3, polls + ' polls');
  check('and the build gives up rather than grinding', last.building === false);
  check('with something the traveller can act on',
    /stopped answering/.test(last.error || ''), last.error);
}

// --- what a build carries between its own steps -----------------------------
//
// raffy, 2026-09-05: "it seems like its taking so long if it just filling json."
//
// It was not filling one JSON. The eight real builds in Firestore made five to
// fifteen model calls AFTER the itinerary was already written, each re-sending
// a conversation that had grown to between 57 and 87 kB, and two of them ran
// out of steps before they finished.
//
// Two things had to change, and both are checked here: several corrections can
// be applied in one turn, and arguments that have already been applied stop
// being re-sent.
{
  seen = [];
  // Big enough to be worth dropping — the guard leaves small calls alone, so a
  // toy fixture would prove nothing.
  const fat = { ...ITIN, days: [ITIN.days[0], {
    ...ITIN.days[0], title: 'Second',
    items: [{ t: 'Morning', h: 'A long day', p: 'Prose about the day. '.repeat(60) }],
  }] };
  turns = [
    { message: { role: 'assistant', content: '', tool_calls: [tc('save_itinerary', fat)] } },
    // Three corrections in one turn is one wait. Three turns is three, and the
    // traveller watches a progress bar through every one of them.
    { message: { role: 'assistant', content: '', tool_calls: [
      tc('update_trip', { trip: { title: 'Renamed' } }, 'b1'),
      tc('update_day', { index: 1, day: { ...fat.days[1], title: 'Rewritten' } }, 'b2'),
      tc('add_idea', { idea: { n: 'A late idea', verdict: 'yes' } }, 'b3'),
    ] } },
    { message: { role: 'assistant', content: 'Done.' } },
  ];
  const bid = await or.startBuild('Build it.\n\nDestination: Da Nang');
  await or.advanceBuild(bid);
  const n = seen.length;
  const batched = await or.advanceBuild(bid);

  check('several calls in one turn are all applied', seen.length === n + 1,
    (seen.length - n) + ' model call for three edits');
  check('and applied in order', batched.itinerary.trip.title === 'Renamed' &&
    batched.itinerary.days[1].title === 'Rewritten' &&
    (batched.itinerary.ideas || []).some((i) => i.n === 'A late idea'));
  check('each one gets its own result',
    JSON.parse(DOCS.get(bid).messages.stringValue)
      .filter((m) => m.role === 'tool' && ['b1', 'b2', 'b3'].includes(m.tool_call_id)).length === 3);

  await or.advanceBuild(bid);                       // the turn that says Done
  const last = seen[seen.length - 1].messages;
  const heavy = (name) => last
    .flatMap((m) => m.tool_calls || [])
    .filter((c) => c.function.name === name);
  check('an applied itinerary is not re-sent on every later step',
    heavy('save_itinerary').every((c) => c.function.arguments.length < 40),
    (heavy('save_itinerary')[0] || { function: {} }).function.arguments);
  check('nor is a whole rewritten day',
    heavy('update_day').every((c) => c.function.arguments.length < 40),
    (heavy('update_day')[0] || { function: {} }).function.arguments);
  check('but the calls are still there for their results to answer to',
    heavy('save_itinerary').length === 1 && !!heavy('save_itinerary')[0].id);
  check('and the model is handed the index instead',
    last.some((m) => m.role === 'tool' && /days:\s+0 /.test(m.content || '')));
  check('the brief itself is never compacted away', last[1].content.includes('Da Nang'));
  check('and the build then finishes', (await or.advanceBuild(bid)).building === false);
  seen = [];
}

// --- the ways it goes wrong ----------------------------------------------
seen = [];
turns = [
  { message: { role: 'assistant', content: 'Here is your itinerary in prose!' } },
  { message: { role: 'assistant', content: '', tool_calls: [tc('save_itinerary', ITIN)] } },
  { message: { role: 'assistant', content: 'Done.' } },
];
const id2 = await or.startBuild('brief');
await or.advanceBuild(id2);
check('prose instead of a tool call is pushed back on',
  JSON.parse(DOCS.get(id2).messages.stringValue).slice(-1)[0].content.includes('save_itinerary'));
await or.advanceBuild(id2);
const r2 = await or.advanceBuild(id2);
check('and it recovers', r2.itinerary && r2.building === false);

seen = [];
turns = [{ message: { role: 'assistant', content: '', tool_calls: [tc('save_itinerary', '{not json')] } },
         { message: { role: 'assistant', content: '', tool_calls: [tc('save_itinerary', ITIN)] } },
         { message: { role: 'assistant', content: 'ok' } }];
const id3 = await or.startBuild('brief');
await or.advanceBuild(id3);
check('unparseable arguments are answered, not thrown on',
  JSON.parse(DOCS.get(id3).messages.stringValue).some((m) => m.role === 'tool' && /not valid JSON/.test(m.content)));

seen = [];
turns = [{ throw: true }, { message: { role: 'assistant', content: '', tool_calls: [tc('save_itinerary', ITIN)] } },
         { message: { role: 'assistant', content: 'ok' } }];
const id4 = await or.startBuild('brief');
const r4 = await or.advanceBuild(id4);
check('a failed call does not kill the build', r4.building === true && !r4.error);
await or.advanceBuild(id4);
check('the next poll picks it up', (await or.advanceBuild(id4)).itinerary !== null);

// It must not be able to loop forever on his money.
seen = [];
turns = Array.from({ length: 40 }, () => ({ message: { role: 'assistant', content: '', tool_calls: [tc('update_trip', { trip: {} })] } }));
const id5 = await or.startBuild('brief');
let guard = 0;
while ((await or.advanceBuild(id5)).building && guard < 40) guard++;
check('a runaway build is stopped', guard < 20, guard + ' polls');


// --- an unknown tool ------------------------------------------------------
seen = [];
turns = [{ message: { role: 'assistant', content: '', tool_calls: [tc('make_website', {})] } },
         { message: { role: 'assistant', content: '', tool_calls: [tc('save_itinerary', ITIN)] } },
         { message: { role: 'assistant', content: 'ok' } }];
const id6 = await or.startBuild('brief');
await or.advanceBuild(id6);
check('a tool that does not exist is refused',
  JSON.parse(DOCS.get(id6).messages.stringValue).some((m) => m.role === 'tool' && m.content === 'Unknown tool.'));

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
