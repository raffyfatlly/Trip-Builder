// Running the builder agent.
//
// The chat agent calls build_itinerary with a brief. That brief becomes the
// first (and only) message of a fresh builder session. The builder researches,
// calls the itinerary tools, and goes idle.
//
// The builder session id is written back into the chat session as the tool
// result, which is how the itinerary is found again later without any storage:
// read the chat log, find the builder session ids, replay those sessions.

import { createSession, sendUserMessage, listEvents, sendEvents } from './managedAgents.js';
import { buildItinerary, resultFor, TOOL_NAMES } from './itinerary.js';
import { BUILDER_AGENT_ID, ENV_ID } from './config.js';

// Marker the chat agent's tool result carries, so the builder session id can be
// recovered from the chat transcript later.
export const BUILT_MARKER = '§BUILT§';

export function briefToText(b) {
  const line = (label, v) => (v ? label + ': ' + v + '\n' : '');
  const people = (b.travellers || [])
    .map((t) => t.name + (t.age ? ' (' + t.age + ')' : '') + (t.note ? ' — ' + t.note : ''))
    .join('; ');
  const stays = (b.stays || [])
    .map((s) => s.name + (s.dates ? ', ' + s.dates : '') +
      (s.confirmed === false ? ' [NOT CONFIRMED]' : ''))
    .join('; ');

  return (
    'Build the itinerary for this trip.\n\n' +
    line('Destination', b.destination) +
    line('Dates', (b.start || '') + ' to ' + (b.end || '')) +
    line('Travellers', people) +
    line('Stays', stays) +
    line('Flights', b.flights) +
    line('Budget', b.budget) +
    line('Dietary', b.dietary) +
    line('Pace', b.pace) +
    line('Interests', b.interests) +
    line('Already fixed', b.known) +
    line('They sent', b.attachments) +
    '\nWhat the assistant who spoke to them noticed:\n' +
    (b.considerations || '') + '\n'
  );
}

// Run a builder session to completion. Returns { sessionId, itinerary }.
export async function runBuilder(brief, { maxWaitMs = 600000 } = {}) {
  const session = await createSession(BUILDER_AGENT_ID, ENV_ID);
  await sendUserMessage(session.id, [{ type: 'text', text: briefToText(brief) }]);

  const deadline = Date.now() + maxWaitMs;
  let seen = 0;

  while (Date.now() < deadline) {
    const events = await listEvents(session.id);
    const fresh = events.slice(seen);
    const idle = fresh.find((e) => e.type === 'session.status_idle');

    if (!idle) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    seen = events.length;

    if (idle.stop_reason && idle.stop_reason.type === 'requires_action') {
      const calls = fresh.filter((e) => e.type === 'agent.custom_tool_use');
      const results = calls.map((call) => {
        const upto = events.slice(0, events.indexOf(call) + 1);
        const state = TOOL_NAMES.includes(call.name) ? buildItinerary(upto) : null;
        return {
          type: 'user.custom_tool_result',
          custom_tool_use_id: call.id,
          content: [{
            type: 'text',
            text: TOOL_NAMES.includes(call.name) ? resultFor(call.name, state) : 'Unknown tool.',
          }],
        };
      });
      if (results.length) await sendEvents(session.id, results);
      continue;
    }

    return { sessionId: session.id, itinerary: buildItinerary(await listEvents(session.id)) };
  }
  return { sessionId: session.id, itinerary: null, timedOut: true };
}
