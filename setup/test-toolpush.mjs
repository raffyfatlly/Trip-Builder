// A tool schema written here has to be able to reach the live agent.
//
// 2026-09-08: check_prices grew a `style` field so the agent could search for
// "luxury hotel in Venice" instead of "Venice", and the prompt was updated to
// tell it to send one. pushPrompt sent the LIVE tools back verbatim — to
// protect what raffy set in the Console — which meant the new field would never
// have arrived and the instruction was to do something impossible. The same
// shape as the stale-prompt bug, one layer down.
//
//   node setup/test-toolpush.mjs
import { mergeTools, CHAT_TOOLS } from '../lib/agentSync.js';
import { PRICE_TOOL } from '../lib/prices.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };
const nameOf = (t) => (t && (t.name || t.type)) || '';
const byName = (list, n) => list.find((t) => nameOf(t) === n);

console.log('');
// What the live agent looks like: our tools as they were when he last set them,
// plus something he added in the Console that this repo knows nothing about.
const stale = JSON.parse(JSON.stringify(PRICE_TOOL));
delete stale.input_schema.properties.hotels.items.properties.style;
const live = [
  { type: 'agent_toolset_20260401', default_config: { enabled: false }, configs: [{ name: 'web_search', enabled: true }] },
  stale,
  { name: 'something_he_added', description: 'set in the Console', input_schema: { type: 'object' } },
];

const merged = mergeTools(live);

ok('the stale schema is replaced with the current one',
   !!byName(merged, 'check_prices').input_schema.properties.hotels.items.properties.style);
ok('what he set in the Console is untouched',
   JSON.stringify(byName(merged, 'something_he_added')) === JSON.stringify(live[2]));
ok('nothing is dropped', live.every((t) => merged.some((m) => nameOf(m) === nameOf(t))),
   merged.map(nameOf).join(', '));
ok('and every tool this repo defines is on it',
   CHAT_TOOLS().every((t) => merged.some((m) => nameOf(m) === nameOf(t))),
   CHAT_TOOLS().map(nameOf).filter((n) => !merged.some((m) => nameOf(m) === n)).join(', ') || 'all there');
ok('order is kept, so a diff of the agent stays readable',
   nameOf(merged[0]) === nameOf(live[0]) && nameOf(merged[1]) === nameOf(live[1]));

// A tool added here that the agent has never seen must still arrive.
const thin = mergeTools([live[2]]);
ok('a brand new tool is appended rather than lost',
   thin.some((t) => nameOf(t) === 'check_prices') && thin.some((t) => nameOf(t) === 'something_he_added'));

// And an agent with nothing on it gets exactly what this repo says.
ok('an empty agent gets the full set', mergeTools([]).length === CHAT_TOOLS().length);

// THE BUILDER AGENT GETS THE SAME TREATMENT, AND NEVER HAD IT.
//
// raffy, 2026-09-09: "why don't u check the build agents too." Its find_photos
// kept arriving as a string where the code expects an array of objects, and
// every fix before this treated that as the model being sloppy. It was not:
// the live agent carries its own tool schemas, nothing had ever pushed the
// builder's, so it was obeying an old one faithfully while this repo answered
// it from a new one.
console.log('\nthe builder agent, which had never been pushed');
{
  const { BUILDER_TOOLSET } = await import('../lib/agentSync.js');
  const OURS = BUILDER_TOOLSET();
  const staleFind = JSON.parse(JSON.stringify(OURS.find((t) => nameOf(t) === 'find_photos')));
  // The shape the live agent plausibly carried: queries as a plain string.
  staleFind.input_schema.properties.queries = { type: 'string', description: 'old' };
  const liveBuilder = [staleFind, { name: 'his_own_thing', input_schema: { type: 'object' } }];

  const merged = mergeTools(liveBuilder, OURS);
  const find = byName(merged, 'find_photos');
  ok('the builder find_photos is restored to an array of objects',
     find.input_schema.properties.queries.type === 'array',
     find.input_schema.properties.queries.type);
  ok('every builder tool this repo defines is on it',
     OURS.every((t) => merged.some((m) => nameOf(m) === nameOf(t))),
     OURS.map(nameOf).join(', '));
  // The list used to be the six itinerary ops only, which is why no push could
  // ever have corrected find_photos on the agent.
  ok('and find_photos is one of them', OURS.some((t) => nameOf(t) === 'find_photos'));
  ok('and nothing of his is dropped', merged.some((t) => nameOf(t) === 'his_own_thing'));
  // The two agents must not be given each other's tools.
  ok('the builder does not get the chat agent\'s tools',
     !merged.some((t) => nameOf(t) === 'check_prices'),
     merged.map(nameOf).join(', ').slice(0, 120));
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
