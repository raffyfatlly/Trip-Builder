// Does the chat agent behave like a travel agent rather than a form?
//
// Asks a hotel question with a budget attached and checks that it searched,
// presented real options with prices, and recommended one — instead of asking
// which area they would like.
//
//   node --env-file=.env setup/test-agent-research.js

import { createSession, sendUserMessage, listEvents, getState } from '../lib/managedAgents.js';
import { CHAT_AGENT_ID, ENV_ID } from '../lib/config.js';

const s = await createSession(CHAT_AGENT_ID, ENV_ID);
console.log('session ' + s.id + '\n');

const ask = async (text, label) => {
  console.log('\x1b[36m> ' + label + '\x1b[0m');
  await sendUserMessage(s.id, [{ type: 'text', text }]);
  const t0 = Date.now();
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await getState(s.id);
    if (!st.thinking && !st.building) break;
  }
  console.log('  (' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
};

await ask(
  "hi, looking at Da Nang Vietnam in September with my wife and 2 kids (6 and 3). " +
  "we haven't booked a hotel yet. budget is around RM400 a night, beachfront if possible. " +
  "we're muslim so halal food nearby matters.",
  'hotel question with a budget');

const events = await listEvents(s.id);

const searches = events.filter((e) => e.type === 'agent.tool_use' && /search|fetch/i.test(e.name || ''));
const presents = events.filter((e) => e.type === 'agent.custom_tool_use' && e.name === 'present');
const builds = events.filter((e) => e.type === 'agent.custom_tool_use' && e.name === 'build_itinerary');

console.log('\nweb searches:   ' + searches.length);
console.log('present cards:  ' + presents.length);
console.log('built early:    ' + (builds.length > 0) + '   (should be false - no hotel yet)');

for (const p of presents) {
  const b = p.input || {};
  console.log('\n  card: ' + b.kind + ' — ' + b.title);
  if (b.intro) console.log('        ' + b.intro);
  (b.items || []).forEach((o) => {
    console.log('    * ' + o.name + (o.price ? '   ' + o.price : '   (no price)'));
    if (o.meta) console.log('      ' + o.meta);
    console.log('      why: ' + (o.why || '').slice(0, 150));
    if (o.watch) console.log('      watch: ' + o.watch.slice(0, 120));
  });
  (b.facts || []).forEach((f) => console.log('    * ' + f.label + ': ' + f.value));
}

const withPrice = presents.flatMap((p) => (p.input.items || [])).filter((o) => o.price);
const total = presents.flatMap((p) => (p.input.items || [])).length;
console.log('\noptions with a price: ' + withPrice.length + '/' + total);

const reply = events.filter((e) => e.type === 'agent.message').pop();
console.log('\nreply:\n' + (reply ? (reply.content || []).map((c) => c.text || '').join('')
  .trim().split('\n').map((l) => '  ' + l).join('\n') : '(none)'));
