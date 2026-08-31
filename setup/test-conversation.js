// End-to-end test of the riskiest assumption in the whole project: that the
// model actually produces a good itinerary in this schema, with real research
// behind it.
//
// Run before building any UI. If this comes out bland or malformed, the schema
// or the prompt is wrong and no amount of frontend fixes it.
//
//   node setup/test-conversation.js

import { createSession, sendUserMessage, runTurn } from '../lib/managedAgents.js';
import { AGENT_ID, ENV_ID } from '../lib/config.js';
import fs from 'fs';

const say = async (sessionId, text, label) => {
  console.log('\n\x1b[36m> ' + label + '\x1b[0m');
  await sendUserMessage(sessionId, [{ type: 'text', text }]);
  const t0 = Date.now();
  const r = await runTurn(sessionId, {
    onProgress: (name, state) =>
      console.log('  \x1b[33m[' + name + ']\x1b[0m -> ' +
        (state ? `${state.days.length} days, ${state.stays.length} stays, ${state.ideas.length} ideas` : 'null')),
  });
  console.log('  (' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
  if (r.reply) console.log('\n' + r.reply.trim().split('\n').map((l) => '  ' + l).join('\n'));
  return r;
};

const session = await createSession(AGENT_ID, ENV_ID);
console.log('session ' + session.id);

await say(session.id,
  "hi! planning a trip to Da Nang, Vietnam with my wife Aisyah and our two kids, Adam who's 6 and Nur who's 3. We fly out 10 September and come back the 14th. We're muslim so halal food matters. staying at Furama Resort Da Nang the whole time.",
  'first message (should trigger save_itinerary)');

const r2 = await say(session.id,
  "can you add something viral / good for photos? my wife likes places that look good on instagram",
  'follow-up (should research and add ideas)');

const it = r2.itinerary;
console.log('\n' + '='.repeat(60));
if (!it) { console.log('NO ITINERARY PRODUCED'); process.exit(1); }

fs.writeFileSync(new URL('./test-output.json', import.meta.url), JSON.stringify(it, null, 2));

console.log('trip      ' + it.trip.title + '  ' + it.trip.start + ' to ' + it.trip.end);
console.log('tz offset ' + it.trip.tzOffsetMin + ' min');
console.log('travellers ' + it.trip.travellers.map((t) => t.name + '(' + t.initial + ')').join(', '));
console.log('stays     ' + it.stays.map((s) => s.short + ' ci' + s.ci + '/co' + s.co).join(' | '));
console.log('coords    ' + it.stays.map((s) => s.lat + ',' + s.lon).join(' | '));
console.log('days      ' + it.days.length);
console.log('items     ' + it.days.reduce((n, d) => n + d.items.length, 0));
console.log('outdoor   ' + it.days.reduce((n, d) => n + d.items.filter((i) => i.out).length, 0));
console.log('ideas     ' + it.ideas.length);

const names = it.trip.travellers.map((t) => t.name);
const prose = it.days.flatMap((d) => d.items.map((i) => i.p)).join(' ');
const named = names.filter((n) => prose.includes(n));
console.log('names in prose: ' + (named.length ? named.join(', ') : 'NONE - personalisation failed'));

const halal = it.stays.filter((s) => s.halal).length;
console.log('halal notes: ' + halal + '/' + it.stays.length + ' stays');

console.log('\n--- sample day ---');
const d = it.days[1] || it.days[0];
console.log(d.dow + ' ' + d.dom + '  ' + d.title + ' — ' + d.sub);
d.items.slice(0, 3).forEach((i) => {
  console.log('  ' + i.t + '  ' + i.h + (i.out ? '  [outdoor]' : ''));
  console.log('      ' + (i.p || '').slice(0, 150));
});
if (it.ideas[0]) {
  console.log('\n--- sample idea ---');
  console.log('  ' + it.ideas[0].n + ' (' + it.ideas[0].verdict + ')');
  console.log('  why:  ' + (it.ideas[0].why || '').slice(0, 180));
  console.log('  warn: ' + (it.ideas[0].warn || 'MISSING').slice(0, 180));
}
console.log('\nfull output -> setup/test-output.json');
