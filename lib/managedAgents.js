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
import { planFrom, noteResult } from './plan.js';
import { isEmpty } from './memory.js';
import { findPhotos } from './photos.js';
import { orBuilderReady, startBuild, advanceBuild, peekBuild } from './orBuilder.js';
import { fetchWith } from './net.js';

// Anthropic is reliable, but "reliable" is not "always" — and /api/state does
// several of these in a row, so one stall takes the whole page down.
const T_READ = 25000;    // listing a session's events
const T_WRITE = 90000;   // creating a session or posting a message
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
  const res = await fetchWith(API + '/v1/sessions', T_WRITE, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ agent: { type: 'agent', id: agentId }, environment_id: envId }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('createSession ' + res.status + ' ' + text);
  return JSON.parse(text);
}

export async function listEvents(sessionId) {
  const res = await fetchWith(API + `/v1/sessions/${sessionId}/events`, T_READ, { headers: headers() });
  if (!res.ok) throw new Error('listEvents ' + res.status);
  const data = await res.json();
  return data.data || [];
}

export async function sendEvents(sessionId, events) {
  const res = await fetchWith(API + `/v1/sessions/${sessionId}/events`, T_WRITE, {
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
    // Answered from the chat log itself — the plan is just these calls replayed,
    // so there is nothing to store and nothing that can drift.
    if (call.name === 'note_plan') {
      const upto = events.slice(0, events.indexOf(call) + 1);
      results.push({
        type: 'user.custom_tool_result', custom_tool_use_id: call.id,
        content: [{ type: 'text', text: noteResult(planFrom(upto)) }],
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
    // Memory is not stored here. The call is recorded in the chat log like
    // every other tool call, and the browser folds it into the profile it
    // holds — same shape as the itinerary edits, and the server stays stateless.
    if (call.name === 'remember' || call.name === 'forget') {
      results.push({
        type: 'user.custom_tool_result', custom_tool_use_id: call.id,
        content: [{
          type: 'text',
          text: call.name === 'remember'
            ? 'Saved for their next trip. Do not mention it unless they ask — say it back naturally if at all.'
            : 'Forgotten.',
        }],
      });
      continue;
    }
    if (call.name === 'propose_trip') {
      results.push({
        type: 'user.custom_tool_result', custom_tool_use_id: call.id,
        content: [{
          type: 'text',
          text: 'The proposal is on their screen, with a button to accept it and one to ask for changes. '
            + 'Say one line and stop — do not repeat it back, and do NOT build until they answer.',
        }],
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
      const brief = briefToText(call.input || {});

      // The builder runs on OpenRouter when one is configured. It stopped
      // researching, so it no longer needs the Managed Agents runtime — and it
      // is the expensive half of the app by a wide margin.
      if (orBuilderReady()) {
        const id = await startBuild(brief);
        results.push({
          type: 'user.custom_tool_result', custom_tool_use_id: call.id,
          content: [{
            type: 'text',
            text: 'openrouter_build=' + id +
              '\nThe itinerary is being built now and will appear beside the chat shortly. ' +
              'Tell them it is building, and what you still need from them. Do not describe the itinerary itself.',
          }],
        });
        continue;
      }

      const s = await createSession(BUILDER_AGENT_ID, ENV_ID);
      await sendUserMessage(s.id, [{ type: 'text', text: brief }]);
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

// Photo search runs here, not in the agent. Managed Agents' web_fetch only
// retrieves URLs already in the conversation, so a Commons API URL the model
// assembles itself is always refused — which is exactly why the first builds
// came back with no pictures at all.
export async function answerBuilderCall(call, events) {
  if (call.name === 'find_photos') {
    try {
      return await findPhotos((call.input && call.input.queries) || []);
    } catch (err) {
      return 'Photo search failed: ' + err.message + '. Carry on without photos for these.';
    }
  }
  if (!TOOL_NAMES.includes(call.name)) return 'Unknown tool.';
  // The itinerary as it stands at this call, so each edit sees its own effect.
  return resultFor(call.name, buildItinerary(events.slice(0, events.indexOf(call) + 1)));
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

  const results = await Promise.all(pending.map(async (call) => {
    const text = await answerBuilderCall(call, events);
    return {
      type: 'user.custom_tool_result',
      custom_tool_use_id: call.id,
      content: [{ type: 'text', text }],
    };
  }));
  await sendEvents(sessionId, results);
  return { events: await listEvents(sessionId), answered: true };
}

// Every build this conversation has started, oldest first, recovered from the
// chat transcript. Two kinds now — a Managed Agents session, or an OpenRouter
// build — and the marker in the tool result says which.
export function buildsIn(events) {
  return events
    .filter((e) => e.type === 'user.custom_tool_result')
    .flatMap((e) => (e.content || []).map((c) => c.text || ''))
    .map((t) => {
      const or = t.match(/openrouter_build=(\S+)/);
      if (or) return { kind: 'openrouter', id: or[1] };
      const ma = t.match(/builder_session=(\S+)/);
      return ma ? { kind: 'session', id: ma[1] } : null;
    })
    .filter(Boolean);
}

// Kept for the tests and scripts that predate the OpenRouter path.
export const builderSessionsIn = (events) =>
  buildsIn(events).filter((b) => b.kind === 'session').map((b) => b.id);

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

// What is it doing right now, in words a traveller would use.
//
// raffy, 2026-09-01: "can we do like how claude do, when its loading say
// something so poeople can be assured its not stuck or something."
//
// Read off the real event log rather than rotating through invented phrases —
// if it says "looking up photos" it is because find_photos has not answered
// yet. A made-up status is worse than three dots: it keeps reassuring you
// while the thing is genuinely stuck.
const DOING = {
  web_search: 'Searching the web',
  web_fetch: 'Reading a page',
  find_photos: 'Looking for photos',
  present: 'Putting the options together',
  propose_trip: 'Sketching the trip',
  build_itinerary: 'Starting your itinerary app',
  remember: 'Making a note',
  forget: 'Updating your profile',
  read_itinerary: 'Checking the itinerary',
};

export function doingNow(events) {
  // The last tool that started and has no result yet. Walk backwards: the most
  // recent unanswered one is what it is stuck on or busy with.
  const answered = new Set(
    events.filter((e) => e.type === 'user.custom_tool_result').map((e) => e.custom_tool_use_id));
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'agent.custom_tool_use' && !answered.has(e.id)) return DOING[e.name] || null;
    // Server-side tools resolve within the same turn, so the last one seen
    // while still running is what it is on.
    if (e.type === 'agent.tool_use') return DOING[e.name] || null;
    if (e.type === 'user.message') break;   // nothing since they last spoke
  }
  return null;
}

// Reading, and advancing, are two different jobs.
//
// raffy, 2026-09-01: the Italy trip rendered blank and stayed blank. The cause
// was not a hung fetch — it was this function. It advanced the build BEFORE
// and AFTER pumping the chat, so one poll could make two model calls plus all
// their tool work, and the request that draws the page took longer than
// Vercel's 300-second ceiling. The conversation was intact the whole time; the
// endpoint that reads it was busy doing the agent's work.
//
// So: getState only reads. It makes no model call and never writes. It is
// bounded by two event listings and one Firestore read, and it always answers.
// Everything that costs money or time moves to advanceState below, which the
// browser calls separately and can afford to have take two minutes.

async function look(chatEvents) {
  const builds = buildsIn(chatEvents);
  const latest = builds[builds.length - 1] || null;
  if (!latest) return { itinerary: null, building: false, buildError: '' };

  if (latest.kind === 'openrouter') {
    const r = await peekBuild(latest.id);
    return { itinerary: r.itinerary, building: r.building, buildError: r.error };
  }
  const bEvents = await listEvents(latest.id);
  return {
    itinerary: buildItinerary(bEvents),
    building: busy(bEvents) || isPending(bEvents).length > 0,
    buildError: '',
  };
}

// The work: answer pending tool calls, start builders, advance the build by one
// step. Slow on purpose, and nothing renders from it.
export async function advanceState(chatSessionId) {
  const chatEvents = await listEvents(chatSessionId);
  const before = await look(chatEvents);

  // The agent edits the itinerary it can see, so hand it the edited version.
  const visible = applyEdits(before.itinerary, agentEditsIn(chatEvents));
  await pumpChat(chatSessionId, visible);

  // One build step per call, so this stays bounded too.
  const builds = buildsIn(await listEvents(chatSessionId));
  const latest = builds[builds.length - 1] || null;
  if (latest) {
    if (latest.kind === 'openrouter') await advanceBuild(latest.id);
    else await pumpBuilder(latest.id);
  }
  return { ok: true };
}

export async function getState(chatSessionId) {
  const chatEvents = await listEvents(chatSessionId);
  const agentEdits = agentEditsIn(chatEvents);
  const { itinerary, building, buildError } = await look(chatEvents);

  return {
    transcript: eventsToTranscript(chatEvents),
    itinerary,
    plan: planFrom(chatEvents),
    // What the agent asked to remember this session, for the browser to fold
    // into the profile it keeps.
    memoryOps: chatEvents
      .filter((e) => e.type === 'agent.custom_tool_use' && (e.name === 'remember' || e.name === 'forget'))
      .map((e) => ({ id: e.id, name: e.name, input: e.input || {} })),
    agentEdits,
    building,
    buildError,
    thinking: busy(chatEvents),
    doing: doingNow(chatEvents),
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

// What the agent did, in words a traveller would use.
//
// A turn that takes twenty seconds and comes back with three hotel prices
// looks like magic or like a stall, depending on your mood. Showing the four
// searches behind it costs nothing and turns both into "it went and looked".
//
// Cards are excluded on purpose: present and propose_trip already appear as
// themselves, and listing "showed you options" underneath the options is
// noise.
function actionOf(e) {
  if (e.type === 'agent.tool_use') {
    const q = (e.input && (e.input.query || e.input.url)) || '';
    if (e.name === 'web_search') return { icon: 'search', text: 'Searched', detail: q };
    if (e.name === 'web_fetch') return { icon: 'search', text: 'Read a page', detail: q };
    return { icon: 'dot', text: e.name || 'Did something' };
  }
  if (e.type !== 'agent.custom_tool_use') return null;
  const i = e.input || {};
  switch (e.name) {
    case 'note_plan': {
      const keys = Object.keys(i).filter((k) => k !== 'ready' && i[k]);
      return keys.length ? { icon: 'check', text: 'Settled ' + keys.join(', ') } : null;
    }
    case 'remember': return { icon: 'star', text: 'Saved something for next time' };
    case 'forget': return { icon: 'dot', text: 'Forgot what you asked it to' };
    case 'read_itinerary': return { icon: 'dot', text: 'Checked the itinerary' };
    case 'edit_itinerary': {
      const n = (i.ops || []).length;
      return { icon: 'pen', text: 'Edited the itinerary' + (n > 1 ? ' — ' + n + ' changes' : '') };
    }
    case 'build_itinerary': return { icon: 'build', text: 'Started building' };
    case 'find_photos': return { icon: 'photo', text: 'Looked for photos' };
    default: return null;
  }
}

export function eventsToTranscript(events) {
  const out = [];
  let actions = [];
  for (const e of events) {
    if (e.type === 'agent.custom_tool_use' && (e.name === 'present' || e.name === 'propose_trip')) {
      const b = blockFrom(e);
      if (b) out.push(b);
      continue;
    }

    const act = actionOf(e);
    if (act) { actions.push(act); continue; }

    if (e.type !== 'user.message' && e.type !== 'agent.message') continue;
    const text = (e.content || []).map(display).filter(Boolean).join('\n');
    if (!text) { if (e.type === 'user.message') actions = []; continue; }

    const row = { role: e.type === 'agent.message' ? 'assistant' : 'user', text, id: e.id };
    // The work happened before the reply, but it reads better underneath it:
    // the answer first, then how it got there.
    if (row.role === 'assistant' && actions.length) row.actions = actions;
    actions = [];
    out.push(row);
  }
  return out;
}
