// Managed Agents plumbing, built for stateless serverless functions.
//
// Nothing here holds a connection open or waits for a turn to finish. A build
// takes minutes and a Vercel function does not live that long, so instead the
// client polls and EACH POLL DOES A BOUNDED AMOUNT OF WORK: resolve whatever
// tool calls are pending right now, then return.
//
// That also gives better behaviour than blocking would — the chat keeps
// talking while the builder is still researching in its own session.

import { buildItinerary, resultFor, TOOL_NAMES } from './itinerary.js';
import { briefToText } from './build.js';
import { BUILDER_AGENT_ID, ENV_ID, apiKey } from './config.js';

const API = 'https://api.anthropic.com';

function headers() {
  const key = apiKey();
  if (!key) throw new Error('no API key');
  return {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'managed-agents-2026-04-01,files-api-2025-04-14',
    'content-type': 'application/json',
  };
}

export async function createSession(agentId, envId) {
  const res = await fetch(API + '/v1/sessions', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ agent: { type: 'agent', id: agentId }, environment_id: envId }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('createSession ' + res.status + ' ' + text);
  return JSON.parse(text);
}

export async function listEvents(sessionId) {
  const res = await fetch(API + `/v1/sessions/${sessionId}/events`, { headers: headers() });
  if (!res.ok) throw new Error('listEvents ' + res.status);
  const data = await res.json();
  return data.data || [];
}

export async function sendEvents(sessionId, events) {
  const res = await fetch(API + `/v1/sessions/${sessionId}/events`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ events }),
  });
  if (!res.ok) throw new Error('sendEvents ' + res.status + ' ' + (await res.text()));
}

export async function sendUserMessage(sessionId, content) {
  await sendEvents(sessionId, [{ type: 'user.message', content }]);
}

const isPending = (events) => {
  // A custom tool call is outstanding when no result for it has been sent yet.
  const answered = new Set(
    events.filter((e) => e.type === 'user.custom_tool_result').map((e) => e.custom_tool_use_id));
  return events.filter((e) => e.type === 'agent.custom_tool_use' && !answered.has(e.id));
};

// Resolve any outstanding build_itinerary call by STARTING a builder session
// and answering immediately. The chat agent is never left blocked while the
// builder researches — it carries on talking.
async function pumpChat(sessionId) {
  const events = await listEvents(sessionId);
  const pending = isPending(events);
  if (!pending.length) return events;

  const results = [];
  for (const call of pending) {
    if (call.name !== 'build_itinerary') {
      results.push({
        type: 'user.custom_tool_result', custom_tool_use_id: call.id,
        content: [{ type: 'text', text: 'Unknown tool.' }],
      });
      continue;
    }
    try {
      const s = await createSession(BUILDER_AGENT_ID, ENV_ID);
      await sendUserMessage(s.id, [{ type: 'text', text: briefToText(call.input || {}) }]);
      results.push({
        type: 'user.custom_tool_result', custom_tool_use_id: call.id,
        content: [{
          type: 'text',
          // The id is carried in the tool result so the builder session can be
          // found again from the chat log alone. No storage anywhere.
          text: 'builder_session=' + s.id +
            '\nThe itinerary is being built now and will appear beside the chat shortly. ' +
            'Tell them it is building, and what you still need from them. Do not describe the itinerary itself.',
        }],
      });
    } catch (err) {
      results.push({
        type: 'user.custom_tool_result', custom_tool_use_id: call.id,
        content: [{ type: 'text', text: 'Could not start the builder: ' + err.message }],
      });
    }
  }
  await sendEvents(sessionId, results);
  return listEvents(sessionId);
}

// Resolve whatever itinerary tool calls the builder has outstanding.
// Returns { events, answered } — `answered` matters because of a race: right
// after results are sent the session has not emitted status_running yet, so
// the freshly-listed events still show the last status as idle with nothing
// pending. Reporting that as "finished" makes the building indicator flicker
// off mid-build.
async function pumpBuilder(sessionId) {
  const events = await listEvents(sessionId);
  const pending = isPending(events);
  if (!pending.length) return { events, answered: false };

  const results = pending.map((call) => {
    const upto = events.slice(0, events.indexOf(call) + 1);
    const known = TOOL_NAMES.includes(call.name);
    return {
      type: 'user.custom_tool_result',
      custom_tool_use_id: call.id,
      content: [{
        type: 'text',
        text: known ? resultFor(call.name, buildItinerary(upto)) : 'Unknown tool.',
      }],
    };
  });
  await sendEvents(sessionId, results);
  return { events: await listEvents(sessionId), answered: true };
}

// Builder session ids, oldest first, recovered from the chat transcript.
export function builderSessionsIn(events) {
  return events
    .filter((e) => e.type === 'user.custom_tool_result')
    .flatMap((e) => (e.content || []).map((c) => c.text || ''))
    .map((t) => (t.match(/builder_session=(\S+)/) || [])[1])
    .filter(Boolean);
}

const busy = (events) => {
  const last = [...events].reverse().find(
    (e) => e.type === 'session.status_idle' || e.type === 'session.status_running');
  return !last || last.type === 'session.status_running';
};

// One poll: advance both sessions as far as they can go right now, then report.
export async function getState(chatSessionId) {
  const chatEvents = await pumpChat(chatSessionId);

  const builders = builderSessionsIn(chatEvents);
  const current = builders[builders.length - 1] || null;

  let itinerary = null;
  let building = false;
  if (current) {
    const { events: bEvents, answered } = await pumpBuilder(current);
    itinerary = buildItinerary(bEvents);
    building = answered || busy(bEvents) || isPending(bEvents).length > 0;
  }

  return {
    transcript: eventsToTranscript(chatEvents),
    itinerary,
    building,
    thinking: busy(chatEvents),
    turns: chatEvents.filter((e) => e.type === 'user.message').length,
  };
}

function display(c) {
  if (c.type === 'text') return c.text || '';
  if (c.type === 'image') return '📎 image';
  if (c.type === 'document') return `📎 ${c.title || 'file'}`;
  return '';
}

export function eventsToTranscript(events) {
  return events
    .filter((e) => e.type === 'user.message' || e.type === 'agent.message')
    .map((e) => ({
      role: e.type === 'agent.message' ? 'assistant' : 'user',
      text: (e.content || []).map(display).filter(Boolean).join('\n'),
      id: e.id,
    }))
    .filter((m) => m.text);
}
