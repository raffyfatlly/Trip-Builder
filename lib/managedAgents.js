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
import { describeItinerary, toEdits } from './editTools.js';
import { applyEdits } from './edits.js';
import { blockFrom } from './blocks.js';
import { CTX_MARKER } from './context.js';
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
async function pumpChat(sessionId, currentItinerary) {
  const events = await listEvents(sessionId);
  const pending = isPending(events);
  if (!pending.length) return events;

  const results = [];
  for (const call of pending) {
    // Reading and editing are answered right here in the chat session. No
    // builder, no research, no cost beyond the turn itself.
    if (call.name === 'read_itinerary') {
      results.push({
        type: 'user.custom_tool_result', custom_tool_use_id: call.id,
        content: [{ type: 'text', text: describeItinerary(currentItinerary) }],
      });
      continue;
    }
    if (call.name === 'edit_itinerary') {
      const ops = (call.input && call.input.ops) || [];
      const applied = toEdits(ops, 0).length;
      results.push({
        type: 'user.custom_tool_result', custom_tool_use_id: call.id,
        content: [{
          type: 'text',
          text: applied
            ? `Applied ${applied} change${applied > 1 ? 's' : ''}. The traveller can see it now. Tell them briefly what changed.`
            : 'Nothing applied — check the op shapes against read_itinerary.',
        }],
      });
      continue;
    }
    if (call.name === 'present') {
      results.push({
        type: 'user.custom_tool_result', custom_tool_use_id: call.id,
        content: [{ type: 'text', text: 'Shown to the traveller. Keep your message short — do not repeat the cards in prose.' }],
      });
      continue;
    }
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

// The agent's edits live in its own tool calls, so they replay from the chat
// log exactly the way the itinerary replays from the builder's.
export function agentEditsIn(events) {
  let seq = 0;
  const out = [];
  for (const e of events) {
    if (e.type !== 'agent.custom_tool_use' || e.name !== 'edit_itinerary') continue;
    const ops = toEdits((e.input && e.input.ops) || [], seq);
    seq += ops.length + 1;
    out.push(...ops);
  }
  return out;
}

const busy = (events) => {
  const last = [...events].reverse().find(
    (e) => e.type === 'session.status_idle' || e.type === 'session.status_running');
  return !last || last.type === 'session.status_running';
};

// One poll: advance both sessions as far as they can go right now, then report.
export async function getState(chatSessionId) {
  // Read the log first so the itinerary is known before any pending
  // read_itinerary call has to be answered.
  let chatEvents = await listEvents(chatSessionId);

  const resolve = async () => {
    const ids = builderSessionsIn(chatEvents);
    const latest = ids[ids.length - 1] || null;
    if (!latest) return { itinerary: null, building: false, builder: null };
    const { events: bEvents, answered } = await pumpBuilder(latest);
    return {
      itinerary: buildItinerary(bEvents),
      building: answered || busy(bEvents) || isPending(bEvents).length > 0,
      builder: latest,
    };
  };

  let { itinerary, building } = await resolve();

  // The agent edits the itinerary it can see, so hand it the edited version.
  const agentEdits = agentEditsIn(chatEvents);
  const visible = applyEdits(itinerary, agentEdits);

  chatEvents = await pumpChat(chatSessionId, visible);

  // A pump may have started a builder or added edits; re-read both.
  const after = await resolve();
  itinerary = after.itinerary;
  building = after.building;

  return {
    transcript: eventsToTranscript(chatEvents),
    itinerary,
    agentEdits: agentEditsIn(chatEvents),
    building,
    thinking: busy(chatEvents),
    turns: chatEvents.filter((e) => e.type === 'user.message').length,
  };
}

function display(c) {
  // The per-message location/time block is for the agent, not the traveller.
  if (c.type === 'text' && (c.text || '').startsWith(CTX_MARKER)) return '';
  if (c.type === 'text') return c.text || '';
  if (c.type === 'image') return '📎 image';
  if (c.type === 'document') return `📎 ${c.title || 'file'}`;
  return '';
}

export function eventsToTranscript(events) {
  const out = [];
  for (const e of events) {
    if (e.type === 'agent.custom_tool_use' && e.name === 'present') {
      const b = blockFrom(e);
      if (b) out.push(b);
      continue;
    }
    if (e.type !== 'user.message' && e.type !== 'agent.message') continue;
    const text = (e.content || []).map(display).filter(Boolean).join('\n');
    if (!text) continue;
    out.push({ role: e.type === 'agent.message' ? 'assistant' : 'user', text, id: e.id });
  }
  return out;
}
