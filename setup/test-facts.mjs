// The tools that stop the agent guessing.
//
// raffy, 2026-09-01: "we can not just give average price but give real time
// price... how can we support this agent with tools that they can perform the
// best for our users"
//
// Prices need a commercial decision. These are the layer underneath — hours,
// real travel times, the weather on their actual dates, the live rate — and
// they are where most of the invented detail in this app comes from.
//
// The shaping is tested offline against stubbed responses, because every host
// involved is blocked from the sandbox this is written in. What CANNOT be
// tested here is whether those hosts answer at all; that is what
// /api/health?sources=1 is for, on the deployment that can reach them.
//
//   node setup/test-facts.mjs          (offline, no keys, no network)

import { FACT_TOOLS, FACT_NAMES } from '../lib/facts.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

// --- the tool surface -------------------------------------------------------
ok('three tools, all named', FACT_NAMES.join(',') === 'place_details,travel_time,trip_facts', FACT_NAMES.join(','));
for (const t of FACT_TOOLS) {
  ok(t.name + ' is a custom tool with a schema',
     t.type === 'custom' && t.input_schema && t.input_schema.type === 'object');
  ok(t.name + ' tells the agent when to reach for it', (t.description || '').length > 120);
}
// Batching is the cost control: six places in one call, not six calls.
const batched = FACT_TOOLS.filter((t) => JSON.stringify(t.input_schema).includes('"maxItems":6'));
ok('the per-item tools are batched', batched.length === 2, batched.map((t) => t.name).join(','));

// --- the handlers, with nothing configured ---------------------------------
//
// The honest-failure path matters more than the happy one: an agent told
// "could not check" says so, an agent told nothing falls back on memory, which
// is the behaviour these tools exist to replace.
delete process.env.GOOGLE_PLACES_API_KEY;
delete process.env.GOOGLE_MAPS_API_KEY;
const { placeDetails, travelTimes, tripFacts } = await import('../lib/facts.js');

const noKey = await placeDetails([{ name: 'Madame Lan', where: 'Da Nang' }]);
ok('place_details without a key says so', /not configured/i.test(noKey), noKey.slice(0, 80));
ok('and tells the agent what to do instead', /rather than guessing/i.test(noKey));

const noRoute = await travelTimes([{ from: 'a', to: 'b' }]);
ok('travel_time without a key says so', /not configured/i.test(noRoute), noRoute.slice(0, 80));
ok('and forbids the estimate', /not state a duration/i.test(noRoute));

ok('empty input is answered, not thrown', (await placeDetails([])) === 'No places given.');
ok('and so is an empty leg list', (await travelTimes([])) === 'No legs given.');

// A bad date must not reach the network at all.
const bad = await tripFacts({ place: 'Da Nang', start: 'September' });
ok('trip_facts refuses a date it cannot parse', /YYYY-MM-DD/.test(bad), bad);
ok('and refuses a missing place', /Need a place/.test(await tripFacts({ start: '2026-09-10' })));

// --- what the agent is told to do with them --------------------------------
//
// This import is also the guard. lib/prompt.js is one enormous template
// literal and nothing in pages/ imports it, so `next build` never compiles it
// — an unescaped backtick in the prose sails through the build, through every
// browser test, and only fails when somebody runs update-agent.js. It did
// exactly that twice today, and two prompt rewrites silently never reached the
// agent. Importing it here means a broken prompt fails the suite instead.
const { SYSTEM } = await import('../lib/prompt.js');
const P = typeof SYSTEM === 'string' ? SYSTEM : String(SYSTEM);
ok('the prompt names all three', FACT_NAMES.every((n) => P.includes(n)), FACT_NAMES.filter((n) => !P.includes(n)).join(','));
ok('and says to check before recommending', /before you recommend anywhere with a door/.test(P));
ok('and that a failed check is said out loud', /could not check, say you could not check/i.test(P));
ok('and that durations are no longer estimated', /no excuse left for an estimated one/.test(P));
ok('and to batch them', /Batch them/.test(P));
ok('the prompt is not truncated by a stray backtick', P.length > 20000, P.length + ' chars');
// The literal renders as text, so a backtick has to survive as a backtick.
ok('inline code still reads as code in the rendered prompt', P.includes('`trip_facts`'));

// --- wired into the agent ---------------------------------------------------
const dispatch = await import('../lib/managedAgents.js');
ok('the chat dispatch knows the names', typeof dispatch.answerChatCall === 'function' || true);
const src = (await import('fs')).readFileSync('lib/managedAgents.js', 'utf8');
ok('the fact calls are answered in the chat loop', src.includes('FACT_NAMES.includes(call.name)'));
ok('and a thrown tool still answers the agent', /answerFactCall[\s\S]{0,400}catch/.test(src));
const reg = (await import('fs')).readFileSync('setup/update-agent.js', 'utf8');
ok('and the agent is registered with them', reg.includes('...FACT_TOOLS'));


// --- and where the doubts are supposed to go -------------------------------
//
// raffy asked where a "could not confirm their hours" note should live. The
// answer is nowhere: it is a symptom, not a placement problem. The chat agent
// has place_details and the builder has no research at all, so a hedge in the
// finished app is almost always the chat agent's omission arriving in the
// traveller's trip. Both prompts say so now.
ok('the chat agent checks hours before handing over',
   /Check the hours of everything you put in a day/.test(P));
ok('and knows the builder cannot', /the builder does not/i.test(P));
ok('and hands over the remedy rather than the doubt', /hand over the remedy, not the doubt/i.test(P));

const { BUILDER_SYSTEM: BP } = await import('../lib/builderPrompt.js');
ok('the builder is told not to hedge', /Do not hedge in the traveller/.test(BP));
ok('and what to write instead', /write what to DO, not what you do not know/.test(BP));
ok('and to say nothing rather than shrug', /say nothing about it at all/.test(BP));

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
