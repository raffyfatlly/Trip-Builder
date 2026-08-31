// Does the builder find real, working photos?
//
// Deliberately a SHORT trip: this verifies photo sourcing, not itinerary
// quality, and a two-day brief costs a fraction of a full build.
//
//   node --env-file=.env setup/test-photos.js

import { createSession, sendUserMessage, listEvents, sendEvents, answerBuilderCall } from '../lib/managedAgents.js';
import { buildItinerary } from '../lib/itinerary.js';
import { briefToText } from '../lib/build.js';
import { BUILDER_AGENT_ID, ENV_ID } from '../lib/config.js';

const s = await createSession(BUILDER_AGENT_ID, ENV_ID);
console.log('builder session ' + s.id);

await sendUserMessage(s.id, [{ type: 'text', text: briefToText({
  destination: 'Da Nang, Vietnam',
  start: '2026-09-10', end: '2026-09-12',
  travellers: [{ name: 'Aisyah' }, { name: 'Adam', age: '6' }],
  stays: [{ name: 'Furama Resort Da Nang', dates: 'both nights', confirmed: true }],
  considerations: 'Two nights only. Keep it short. Photos matter a lot to them.',
}) }]);

const deadline = Date.now() + 600000;
let seen = 0;
while (Date.now() < deadline) {
  const events = await listEvents(s.id);
  for (const e of events.slice(seen)) {
    if (e.type === 'agent.custom_tool_use') console.log('  TOOL  ' + e.name);
  }
  seen = events.length;
  const idle = events.filter((e) => e.type === 'session.status_idle').pop();
  const answered = new Set(events.filter((e) => e.type === 'user.custom_tool_result')
    .map((e) => e.custom_tool_use_id));
  const pending = events.filter((e) => e.type === 'agent.custom_tool_use' && !answered.has(e.id));
  if (pending.length) {
    // Same answering path the server uses, so find_photos works here too.
    await sendEvents(s.id, await Promise.all(pending.map(async (c) => ({
      type: 'user.custom_tool_result', custom_tool_use_id: c.id,
      content: [{ type: 'text', text: await answerBuilderCall(c, events) }],
    }))));
    continue;
  }
  if (idle && idle.stop_reason && idle.stop_reason.type === 'end_turn') break;
  await new Promise((r) => setTimeout(r, 1500));
}

const it = buildItinerary(await listEvents(s.id));
const photos = (it && it.photos) || {};
const keys = Object.keys(photos);
console.log('\nphotos supplied: ' + keys.length);

let ok = 0, bad = 0;
for (const k of keys) {
  const url = photos[k];
  const wiki = /^https:\/\/upload\.wikimedia\.org\//.test(url);
  const img = /\.(jpe?g|png|webp)$/i.test(url.split('?')[0]);
  console.log('  ' + k.padEnd(14) + (wiki ? 'wikimedia' : 'OTHER HOST') +
    (img ? '' : '  NOT AN IMAGE URL') + '\n    ' + url.slice(0, 110));
  if (wiki && img) ok++; else bad++;
}
console.log('\nvalid image URLs: ' + ok + '/' + keys.length + (bad ? '   ' + bad + ' BAD' : ''));

const attached = [];
if (it) {
  if (it.trip && it.trip.feature && it.trip.feature.photo) attached.push('feature');
  (it.stays || []).forEach((x, i) => x.photo && attached.push('stay' + i));
  (it.days || []).forEach((d, i) => (d.items || []).forEach((x) => x.photo && attached.push('day' + i)));
}
console.log('attached to: ' + (attached.join(', ') || 'NOTHING'));
console.log('credits set: ' + (it ? (it.stays || []).filter((x) => x.photo && x.credit).length : 0) + ' of ' +
  (it ? (it.stays || []).filter((x) => x.photo).length : 0) + ' photo stays');

import fs from 'fs';
if (it) {
  fs.writeFileSync('/home/user/claude/tools/itinerary-generator/trips/photolive.json', JSON.stringify(it, null, 1));
  console.log('\nwrote trips/photolive.json for offline render checks');
}
