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
check('the model id is the one he asked for', or.MODEL() === 'z-ai/glm-5.3');
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

check('it is ready once a key and a store exist', or.orBuilderReady());

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
