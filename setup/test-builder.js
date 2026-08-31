// Drive the builder agent directly with a brief and print every event it
// produces. Isolates "did the builder work?" from the chat and the UI.
//
//   node --env-file=.env setup/test-builder.js

import { createSession, sendUserMessage, listEvents, sendEvents } from '../lib/managedAgents.js';
import { buildItinerary, resultFor, TOOL_NAMES } from '../lib/itinerary.js';
import { briefToText } from '../lib/build.js';
import { BUILDER_AGENT_ID, ENV_ID } from '../lib/config.js';

const brief = {
  destination: 'Da Nang, Vietnam',
  start: '2026-09-10',
  end: '2026-09-14',
  travellers: [
    { name: 'Aisyah', note: 'wife' },
    { name: 'Adam', age: '6' },
    { name: 'Nur', age: '3' },
  ],
  stays: [{ name: 'Furama Resort Da Nang', dates: 'whole trip', confirmed: true }],
  flights: 'not known yet',
  dietary: 'halal, important',
  pace: 'unknown, but a 3 year old means relaxed',
  interests: 'not yet stated',
  known: 'One hotel the whole trip.',
  considerations:
    'Nur is three so afternoon naps matter. One base for four nights means everything is a day trip out and back. Halal is a real constraint. September is the start of the rainy season there.',
};

const s = await createSession(BUILDER_AGENT_ID, ENV_ID);
console.log('builder session ' + s.id);
await sendUserMessage(s.id, [{ type: 'text', text: briefToText(brief) }]);

const t0 = Date.now();
let seen = 0;
const deadline = Date.now() + 600000;

while (Date.now() < deadline) {
  const events = await listEvents(s.id);
  for (const e of events.slice(seen)) {
    const t = ((Date.now() - t0) / 1000).toFixed(0).padStart(4);
    if (e.type === 'agent.custom_tool_use') console.log(t + 's  TOOL  ' + e.name);
    else if (e.type === 'agent.tool_use') console.log(t + 's  web   ' + (e.name || ''));
    else if (e.type === 'agent.message') {
      console.log(t + 's  MSG   ' +
        (e.content || []).map((c) => c.text || '').join('').slice(0, 220).replace(/\n/g, ' '));
    } else if (e.type === 'session.status_idle') {
      console.log(t + 's  idle  ' + JSON.stringify(e.stop_reason || {}));
    } else if (e.type !== 'session.status_running') {
      console.log(t + 's  ' + e.type);
    }
  }
  const fresh = events.slice(seen);
  seen = events.length;

  const idle = fresh.find((e) => e.type === 'session.status_idle');
  if (idle) {
    const answered = new Set(events.filter((e) => e.type === 'user.custom_tool_result')
      .map((e) => e.custom_tool_use_id));
    const pending = events.filter((e) => e.type === 'agent.custom_tool_use' && !answered.has(e.id));
    if (pending.length) {
      await sendEvents(s.id, pending.map((call) => {
        const upto = events.slice(0, events.indexOf(call) + 1);
        return {
          type: 'user.custom_tool_result',
          custom_tool_use_id: call.id,
          content: [{ type: 'text', text: TOOL_NAMES.includes(call.name)
            ? resultFor(call.name, buildItinerary(upto)) : 'Unknown tool.' }],
        };
      }));
      continue;
    }
    break;
  }
  await new Promise((r) => setTimeout(r, 1500));
}

const it = buildItinerary(await listEvents(s.id));
console.log('\n--- result ---');
if (!it) console.log('NO ITINERARY');
else console.log('days=' + it.days.length + ' stays=' + it.stays.length +
  ' ideas=' + it.ideas.length + ' items=' +
  it.days.reduce((n, d) => n + (d.items || []).length, 0));
