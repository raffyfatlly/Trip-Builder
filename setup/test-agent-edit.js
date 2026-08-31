// Does the chat agent EDIT rather than rebuild for a small change?
//
// That is the whole cost argument: an edit is one chat turn, a rebuild is
// about fifty. Reuses a session that already has an itinerary.
//
//   node --env-file=.env setup/test-agent-edit.js <sessionId>

import { sendUserMessage, listEvents, getState } from '../lib/managedAgents.js';
import { applyEdits } from '../lib/edits.js';

const SESSION = process.argv[2];
if (!SESSION) throw new Error('pass a chat session id that already has an itinerary');

const before = await getState(SESSION);
if (!before.itinerary) throw new Error('that session has no itinerary');

const day0 = before.itinerary.days[0];
console.log('itinerary: ' + before.itinerary.days.length + ' days');
console.log('day 0 items:');
day0.items.forEach((x) => console.log('   ' + (x.t || '?').padEnd(12) + x.h));

const target = day0.items[day0.items.length - 1];
const ask = `can you move "${target.h}" to 8:30pm instead? and drop the tags on it`;
console.log('\n> ' + ask + '\n');

await sendUserMessage(SESSION, [{ type: 'text', text: ask }]);

const t0 = Date.now();
let state = null;
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  state = await getState(SESSION);
  if (!state.thinking && !state.building) break;
}
const secs = ((Date.now() - t0) / 1000).toFixed(0);

const events = await listEvents(SESSION);
// Only the calls made AFTER the edit request count. A fixed window would catch
// the original build_itinerary and report a rebuild that never happened.
const askAt = events.findIndex((e) =>
  e.type === 'user.message' &&
  (e.content || []).some((c) => (c.text || '').includes('8:30pm')));
const recent = events.slice(askAt)
  .filter((e) => e.type === 'agent.custom_tool_use').map((e) => e.name);

console.log('took ' + secs + 's');
console.log('tools used for this ask: ' + (recent.join(', ') || 'none'));
console.log('');
console.log('used edit_itinerary:  ' + recent.includes('edit_itinerary'));
console.log('used read_itinerary:  ' + recent.includes('read_itinerary'));
console.log('REBUILT (bad):        ' + recent.includes('build_itinerary'));
console.log('agent edits recorded: ' + (state.agentEdits || []).length);

// getState returns the base itinerary and the edits separately; the client is
// what merges them. Do the same here or the check reads the unedited copy.
const after = applyEdits(state.itinerary, state.agentEdits || []);
const item = after && after.days[0].items.find((x) => x.h === target.h);
console.log('');
console.log('target item time now: ' + (item ? item.t : '(gone)'));
console.log('target tags now:      ' + (item ? JSON.stringify(item.tags || []) : '(gone)'));

const reply = events.filter((e) => e.type === 'agent.message').pop();
if (reply) {
  console.log('\nreply: ' + (reply.content || []).map((c) => c.text || '').join('').trim().slice(0, 300));
}
