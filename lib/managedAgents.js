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
import { blockFrom, unlit, unlitDeep } from './blocks.js';
import { CTX_MARKER } from './context.js';
import { planFrom, noteResult } from './plan.js';
import { isEmpty } from './memory.js';
import { findPhotos, fillPhotoGaps, applyFill } from './photos.js';
import { readFill, writeFill, firestoreConfigured } from './firestore.js';
import { FACT_NAMES, answerFactCall } from './facts.js';
import { RESEARCH_TOOL, research } from './research.js';
import { PRICE_TOOL, checkPrices, loadConfig } from './prices.js';
import { orBuilderReady, startBuild, advanceBuild, peekBuild } from './orBuilder.js';
import { fetchWith, deadline } from './net.js';
import { note, spendTotal, spendAdd } from './journal.js';

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
   // Every branch below is wrapped, and the wrap is the point.
   //
   // raffy's Kundasang trip, 2026-09-05: the conversation stopped dead after
   // "Yes total 3 nights". The research branch referred to `chatSessionId` — the
   // parameter here is `sessionId` — and the reference sat OUTSIDE that branch's
   // own try/catch, so a ReferenceError escaped pumpChat, the loop never reached
   // results.push, and the tool call was left unanswered forever. The session
   // sat idle holding a pending call and nothing could wake it.
   //
   // The typo was mine and is fixed. The shape that turned a typo into a dead
   // conversation is the real defect: no handler should be able to end a turn by
   // throwing. Whatever happens in here, the call gets an answer.
   try {
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
    // The looked-up facts: hours, real travel times, the weather on their
    // dates, the live rate. These run here rather than in the agent because
    // they need our keys — and because a tool that fails has to say so in
    // words the agent will repeat, instead of silently falling back on what it
    // half-remembers, which is the behaviour they exist to replace.
    if (call.name === PRICE_TOOL.name) {
      let text;
      try { text = await checkPrices(call.input || {}); }
      catch (err) {
        text = 'Price lookup failed: ' + err.message
          + '. Give them a search link and do NOT estimate a fare.';
      }
      results.push({
        type: 'user.custom_tool_result', custom_tool_use_id: call.id,
        content: [{ type: 'text', text }],
      });
      continue;
    }
    // The research desk. Runs on our server against OpenRouter, so what comes
    // back into the conversation is a few hundred words rather than fifteen
    // web pages — which is the whole reason it exists. See lib/research.js.
    if (call.name === 'research') {
      let text;
      let out = null;
      const asked = ((call.input || {}).questions || []).length;
      const t0 = Date.now();
      let why = '';
      try {
        out = await research((call.input || {}).questions || []);
        text = out.text;
      } catch (err) {
        why = String(err.message || err).slice(0, 120);
        text = 'The research desk failed: ' + why
          + '. Tell them you could not check rather than guessing.';
      }
      // Written down whether it worked or not.
      //
      // A round that fails costs nothing, so spendAdd below never runs for it
      // and it would leave no trace at all — which is precisely the round you
      // want to find afterwards. The seconds are here for the same reason: the
      // slowest question sets the wait, and the wait is the open complaint.
      note(sessionId, 'research', {
        asked,
        seconds: Math.round((Date.now() - t0) / 100) / 10,
        model: out ? out.model : '',
        via: out ? out.shape : '',
        // A round where every question failed comes back with no usage.
        failed: !why && out && !out.usage ? 1 : (why ? 1 : 0),
        why,
      });
      if (out && out.usage) {
        // The worker's own bill, from OpenRouter's figure rather than a rate
        // table. Its own row, so the cost of research is visible next to the
        // cost of the conversation instead of hidden inside it.
        spendAdd(sessionId, 'research', out.model, {
          in: out.usage.in, out: out.usage.out, calls: out.usage.calls, usd: out.usage.usd,
        });
      }
      results.push({
        type: 'user.custom_tool_result', custom_tool_use_id: call.id,
        content: [{ type: 'text', text }],
      });
      continue;
    }
    if (FACT_NAMES.includes(call.name)) {
      let text;
      try {
        text = await answerFactCall(call.name, call.input || {});
      } catch (err) {
        text = call.name + ' failed: ' + err.message
          + '. Tell them you could not check rather than estimating.';
      }
      results.push({
        type: 'user.custom_tool_result', custom_tool_use_id: call.id,
        content: [{ type: 'text', text }],
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
      if (await orBuilderReady()) {
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
   } catch (err) {
      // A handler threw where nothing expected it to. Answer the call anyway:
      // the agent can say it could not check and carry on, which is a bad turn.
      // Leaving it unanswered is a dead conversation, which is unrecoverable
      // without somebody reading an event log.
      console.error('tool ' + call.name + ' threw:', err);
      note(sessionId, 'error', { tool: call.name, why: String(err && err.message || err) });
      if (!results.some((r) => r.custom_tool_use_id === call.id)) {
        results.push({
          type: 'user.custom_tool_result', custom_tool_use_id: call.id,
          content: [{ type: 'text',
            text: call.name + ' failed unexpectedly. Tell them you could not do that '
              + 'just now and ask if they want to try again.' }],
        });
      }
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
  // A tool call we have not answered yet means work is in flight.
  //
  // raffy, 2026-09-05: "ensure while it's working, the loading icon or text
  // doesn't go off. so that user know its doing real work."
  //
  // The session goes status_idle the INSTANT it hands us a tool call — from its
  // side it is waiting on us, and idle is the truthful word for that. But we
  // are the ones working, and a research round takes half a minute. So the app
  // said "not thinking", dropped the spinner, and looked finished for the whole
  // time it was busiest. Then the answer landed and it started up again.
  //
  // The pending call is the honest signal, and it is the same one the dispatch
  // loop works from.
  if (isPending(events).length) return true;
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
  research: 'Looking things up',
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

// The trail of what it has already done this turn.
//
// raffy, 2026-09-05: "lets say it's taking a while right , can it leave some of
// the steps or action it taken then continue it's task? or else user might
// think it got stuck or something."
//
// One line that changes every so often cannot tell you whether anything is
// happening — a hang and a hard search look identical. A list that grows can:
// each finished step stays on screen, so the wait has visible progress in it.
//
// Same rule as doingNow, which is the rule that matters here: read off the real
// event log, never invent. A step is on this list because a tool call is on the
// log, and it is ticked because its result is on the log too. An invented step
// would keep reassuring you straight through a genuine stall.
const STEP = {
  research: 'Looked it up',
  web_search: 'Searched the web',
  web_fetch: 'Read a page',
  find_photos: 'Looked for photos',
  present: 'Put the options together',
  propose_trip: 'Sketched the trip',
  build_itinerary: 'Started your itinerary',
  remember: 'Made a note',
  forget: 'Updated your profile',
  read_itinerary: 'Checked the itinerary',
  edit_itinerary: 'Made the change',
};

// What it was about, in the traveller's terms. The search query is the single
// most reassuring thing on the list: it is the difference between "working" and
// "looking up ferry times from Sorrento", and it costs nothing to show.
// What a research round says it is looking into.
//
// raffy, 2026-09-05, on seeing six of them listed in full: "what it search for
// look quite messy from user perspective."
//
// He is right. The questions are written for a research desk — "What are the
// best-rated budget to mid-range hotels or homestays in Kundasang, Sabah for
// around RM300-350 per night, based on recent Google/Booking/Agoda reviews?" —
// and six of those is a wall. The tool now asks for a two-or-three-word label
// alongside each one, and that is what the traveller sees: hotels, getting
// there, the weather. Enough to know it is working on the right things.
//
// The full question is the fallback, trimmed hard, for a model that skipped the
// label or sent a bare string.
function researchLabels(input) {
  return ((input || {}).questions || [])
    .map((x) => {
      if (x && typeof x === 'object') {
        const about = String(x.about || '').trim();
        if (about) return about.length > 40 ? about.slice(0, 39) + '\u2026' : about;
        return String(x.q || '').trim().slice(0, 44).replace(/[\s,]+$/, '') + '\u2026';
      }
      return String(x || '').trim().slice(0, 44).replace(/[\s,]+$/, '') + '\u2026';
    })
    .filter((t) => t && t !== '\u2026');
}

function stepDetail(name, input) {
  const i = input || {};
  const cut = (s, n) => {
    const t = String(s || '').trim();
    return t.length > n ? t.slice(0, n - 1).replace(/[\s,]+$/, '') + '\u2026' : t;
  };
  // The questions themselves, not "researching".
  //
  // A research round takes between six and forty seconds, and it used to show
  // nothing at all — the tool had no traveller-facing name, so stepsNow skipped
  // it and the thread just sat there. Naming the questions is most of the fix:
  // waiting is fine when you can see it is looking up five specific things you
  // asked about, and unbearable when it is looking up nothing you can name.
  if (name === 'research') return researchLabels(i).join('\n');
  if (name === 'web_search') return cut(i.query, 52);
  if (name === 'web_fetch') {
    try { return new URL(String(i.url)).hostname.replace(/^www\./, ''); } catch (err) { return ''; }
  }
  if (name === 'present') {
    const n = Array.isArray(i.items) ? i.items.length : 0;
    return n ? n + (n === 1 ? ' option' : ' options') : '';
  }
  if (name === 'propose_trip') return cut(i.destination, 34);
  if (name === 'edit_itinerary') return cut(i.summary, 52);
  return '';
}

// Enough to show it is moving, not so many that it becomes a wall nobody reads.
const MAX_STEPS = 6;

// The turn that failed, and nobody was told.
//
// Found by using the app: a reply never came, the typing dots vanished, and the
// thread just sat there. In the event log was a session.error — the Anthropic
// credit balance had run out — and NOTHING in this codebase read that event
// type. Every transient API failure looked exactly the same as thinking, then
// exactly the same as nothing.
//
// It is the worst failure the app has, because it is silent: the traveller
// waits, then leaves, and nothing anywhere says why.
//
// Only errors since the last thing they said count. An error from three turns
// ago that the agent recovered from is history, not news.
const BILLING = /credit balance|billing|quota|insufficient|payment/i;
const RATE = /rate.?limit|overloaded|too many requests|capacity/i;

export function agentError(events) {
  let from = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'user.message') { from = i; break; }
  }
  const since = events.slice(from);
  const err = [...since].reverse().find((e) => e.type === 'session.error');
  if (!err) return null;
  // Recovered: it errored and then went on to say something anyway.
  const at = since.indexOf(err);
  if (since.slice(at + 1).some((e) => e.type === 'agent.message')) return null;

  const raw = String((err.error && err.error.message) || '');
  const kind = BILLING.test(raw) ? 'billing' : RATE.test(raw) ? 'busy' : 'other';
  return {
    kind,
    // What the traveller is told. Never the raw message — it names an account
    // that is not theirs and asks them to go and top it up.
    say: kind === 'billing'
      ? 'I have run out of credit on my side, so I could not finish that. Nothing you did — it needs topping up before I can keep planning.'
      : kind === 'busy'
        ? 'The model is busy right now. Give it a moment and send that again.'
        : 'Something went wrong on my side and that reply never arrived. Send it again and I will pick it up.',
    // Retrying a billing failure just fails again.
    retry: kind !== 'billing',
  };
}

/**
 * Pick a dead turn back up.
 *
 * A session whose turn failed goes idle with the traveller's message
 * unanswered, and nothing restarts it — advanceState only answers pending tool
 * calls, and a turn that died has none. So the retry button did nothing at all
 * until this existed, which is worse than not offering one.
 *
 * The nudge is sent as a context message, the same invisible channel the
 * per-turn location block uses, so picking a failed turn back up does not put a
 * line in the conversation that the traveller did not say.
 */
export async function resumeChat(chatSessionId) {
  const events = await listEvents(chatSessionId);
  if (busy(events)) return { resumed: false, why: 'still working' };
  // Nothing to resume unless they are actually waiting on an answer.
  let waiting = false;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'agent.message') break;
    if (events[i].type === 'user.message') { waiting = true; break; }
  }
  if (!waiting) return { resumed: false, why: 'nothing waiting' };
  await sendUserMessage(chatSessionId, [{ type: 'text', text: CTX_MARKER +
    ' That turn failed before you answered. Carry on from where you were and answer them now.' }]);
  return { resumed: true };
}

export function stepsNow(events) {
  let from = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'user.message') { from = i + 1; break; }
  }
  const since = events.slice(from);

  const done = new Set();
  for (const e of since) {
    if (e.type === 'user.custom_tool_result') done.add(e.custom_tool_use_id);
    if (e.type === 'agent.tool_result') done.add(e.tool_use_id);
  }

  const out = [];
  for (const e of since) {
    if (e.type !== 'agent.tool_use' && e.type !== 'agent.custom_tool_use') continue;
    const what = STEP[e.name];
    if (!what) continue;                       // a tool with no traveller-facing name
    out.push({ id: e.id, what, detail: stepDetail(e.name, e.input), done: done.has(e.id) });
  }
  // The newest, because those are the ones that say it is still moving.
  return out.slice(-MAX_STEPS);
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

async function look(chatEvents, fill) {
  const builds = buildsIn(chatEvents);
  const latest = builds[builds.length - 1] || null;
  if (!latest) return { itinerary: null, building: false, buildError: '', progress: null };

  if (latest.kind === 'openrouter') {
    const r = await peekBuild(latest.id);
    return {
      itinerary: applyFill(r.itinerary, fill), building: r.building, buildError: r.error,
      // How far along, honestly. A bar that moves because time passed is a
      // lie about progress; this one moves when the builder does.
      progress: r.building ? { step: r.step, steps: r.steps } : null,
    };
  }
  const bEvents = await listEvents(latest.id);
  const building = busy(bEvents) || isPending(bEvents).length > 0;
  return {
    itinerary: applyFill(buildItinerary(bEvents), fill),
    building,
    buildError: '',
    // A Managed Agents build has no step count of its own, so it is measured by
    // the tool calls it has made — which is what it spends its time on.
    progress: building
      ? { step: bEvents.filter((e) => e.type === 'agent.custom_tool_use').length, steps: 14 }
      : null,
  };
}

// The work: answer pending tool calls, start builders, advance the build by one
// step. Slow on purpose, and nothing renders from it.
// What the chat agent has spent so far, read out of its own event log.
//
// Every `session.usage` event is a CUMULATIVE SNAPSHOT of the whole session,
// not that request's share of it. The last one is the answer; adding them up
// multiplies the bill by the number of requests, which on a real session of
// raffy's read $37 against a true $9.30. Checked against the raw events
// 2026-09-04 — thirty snapshots, each larger than the last.
//
// `list_cost` is Anthropic's own figure in cents, and it includes the web
// searches that no token count can show. It is therefore preferred over
// anything computed here; the token maths stays as a fallback and as the thing
// that makes the number explainable.
function chatSpend(events) {
  let last = null;
  let calls = 0;
  for (const e of events || []) {
    if (e && e.type === 'session.usage' && e.usage) { last = e.usage; calls++; }
  }
  if (!last) return null;
  const cc = last.cache_creation || {};
  return {
    calls,
    u: {
      in: last.input_tokens || 0,
      out: last.output_tokens || 0,
      cacheRead: last.cache_read_input_tokens || 0,
      // Nested, and not the flat cache_creation_input_tokens this first
      // reached for — which silently counted every cached prompt as free.
      cacheWrite: (cc.ephemeral_5m_input_tokens || 0) + (cc.ephemeral_1h_input_tokens || 0),
      searches: (last.server_tool_use || {}).web_search_requests || 0,
    },
    usd: last.list_cost && last.list_cost.amount != null
      ? +last.list_cost.amount / 100
      : null,
  };
}

export async function advanceState(chatSessionId, ms = 240000) {
  const chatEvents = await listEvents(chatSessionId);
  const before = await look(chatEvents);

  // The agent edits the itinerary it can see, so hand it the edited version.
  const visible = applyEdits(before.itinerary, agentEditsIn(chatEvents));
  await pumpChat(chatSessionId, visible);

  // The build runs to completion HERE, not one step per poll.
  //
  // raffy, 2026-09-01: "if there's a long process like building app, can it run
  // in background , or if user close the app or go to other trip etc etc."
  //
  // It could not. One step per request meant the build only moved while a
  // browser was polling every 2.5 seconds — close the tab and it stopped dead
  // mid-trip. Nothing was lost (every step is written to Firestore, so it
  // picked up exactly where it stopped) but nothing happened either, which is
  // not what anybody means by "building".
  //
  // A serverless function that has already started keeps running to its own
  // end whether or not anyone is listening, so the fix is to make one request
  // carry the whole build instead of a fourteenth of it. Nothing renders from
  // this endpoint — that was the point of splitting it from /api/state — so it
  // is free to take minutes.
  // Fire and forget, both of these. A journal write must never be the reason a
  // turn is slow, and must never be the reason one fails.
  try {
    const c = chatSpend(await listEvents(chatSessionId));
    if (c) spendTotal(chatSessionId, 'chat', 'claude-sonnet-5', { ...c.u, calls: c.calls }, c.usd);
  } catch (e) { /* the journal is not load-bearing */ }

  const budget = deadline(ms);
  const builds = buildsIn(await listEvents(chatSessionId));
  const latest = builds[builds.length - 1] || null;
  if (!latest) return { ok: true };

  let steps = 0;
  for (;;) {
    if (latest.kind === 'openrouter') {
      const st = await advanceBuild(latest.id);
      steps++;
      if (st.usage) {
        spendAdd(chatSessionId, 'builder', st.model, {
          in: st.usage.prompt_tokens || 0,
          out: st.usage.completion_tokens || 0,
          calls: 1,
          // OpenRouter's own charge for this step, which is why the builder
          // stopped reading as nil. Absent only if the field ever goes away,
          // and then the rate table takes over.
          usd: st.usage.cost != null ? +st.usage.cost : null,
        });
      }
      // Once per build, not once per poll. advanceState runs every couple of
      // seconds and a finished build keeps reporting that it is finished, which
      // put forty-two identical build.done lines in one session's journal.
      if (!st.building) {
        note(chatSessionId, st.error ? 'build.error' : 'build.done',
          { build: latest.id, steps, kb: st.kb || 0, why: st.error || '' }, 'build');
      }
      if (!st.building) break;
    } else {
      const { answered } = await pumpBuilder(latest.id);
      steps++;
      if (!answered) break;
    }
    // Leave room for the last step to finish rather than being cut off
    // half-written: a build killed mid-call loses that call's work.
    if (budget.left() < 45000) break;
  }
  // Every place in the finished trip gets a picture.
  //
  // raffy, 2026-09-02: "i want all places mention (ideas , itenary , hotels)
  // all have photos." The builder attaches one where it happens to look one up,
  // which came to 10, 14 and 7 out of thirty-odd across his three real trips.
  //
  // Here rather than in look(): this runs once when a build finishes, not on
  // every poll. Best-effort throughout — a trip with some pictures missing is
  // a worse trip, a build that fails because a photo lookup did is a disaster.
  try {
    const after = await look(await listEvents(chatSessionId));
    if (after.itinerary && !after.building) {
      const known = await savedFill(chatSessionId);
      const next = await fillPhotoGaps(after.itinerary, known, {
        city: (after.itinerary.trip || {}).title || '',
      });
      // Compared by content, not by key count: an old entry being upgraded
      // with the coordinates it never stored leaves the count identical, and
      // that write is the whole point of the upgrade.
      if (JSON.stringify(next) !== JSON.stringify(known)) {
        await writeFill(chatSessionId, next);
      }
    }
  } catch (err) {
    console.error('photo fill failed:', err);
  }

  return { ok: true, steps };
}

// What has already been paid for. Missing store, missing doc and a broken read
// all mean the same thing here: nothing filled yet, carry on.
async function savedFill(session) {
  if (!firestoreConfigured()) return {};
  try { return await readFill(session); } catch (err) { return {}; }
}

export async function getState(chatSessionId) {
  // Booking links are built during this read, so the marker and token have to
  // be in hand before it. One Firestore read on a cold start, cached after.
  await loadConfig();
  const chatEvents = await listEvents(chatSessionId);
  const agentEdits = agentEditsIn(chatEvents);
  // Photos the app looked up for places the builder left blank. Read, never
  // fetched: this runs on every poll, and a poll must not be able to spend
  // money. The buying happens once, in advanceState, after a build finishes.
  const { itinerary, building, buildError, progress } = await look(chatEvents, await savedFill(chatSessionId));

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
    progress,
    thinking: busy(chatEvents),
    // A turn that died has to say so. Silence is the one thing it must not do.
    agentError: agentError(chatEvents),
    doing: doingNow(chatEvents),
    steps: stepsNow(chatEvents),
    turns: chatEvents.filter((e) => e.type === 'user.message').length,
  };
}

function display(c) {
  // The per-message location/time block is for the agent, not the traveller.
  if (c.type === 'text' && (c.text || '').startsWith(CTX_MARKER)) return '';
  if (c.type === 'text') return unlit(c.text || '');
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
    case 'research': {
      const labels = researchLabels(i);
      return labels.length
        ? { icon: 'search', text: 'Looked up ' + labels.length + (labels.length === 1 ? ' thing' : ' things'),
          detail: labels.join('\n') }
        : null;
    }
    case 'find_photos': return { icon: 'photo', text: 'Looked for photos' };
    default: return null;
  }
}

export function eventsToTranscript(events) {
  const out = [];
  let actions = [];
  // Where the "your itinerary is ready" card belongs in the conversation.
  //
  // raffy, 2026-09-02: "the open app file button should stay at the location
  // where its given and not persisting to be at the bottom of chat everytime."
  // It was rendered after the message list, so it re-pinned itself to the
  // bottom no matter how much was said afterwards — a notification pretending
  // to be part of the conversation. It is a moment in the conversation: the
  // build was started here, and the way in belongs here too, scrolling away
  // with everything else.
  let pendingReady = false;
  for (const e of events) {
    if (e.type === 'agent.custom_tool_use' && e.name === 'build_itinerary') pendingReady = true;
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
    // After the agent has said it is building, not before — "here it is"
    // reading above "I am making it" is the wrong way round.
    if (pendingReady && row.role === 'assistant') { out.push({ role: 'ready', id: e.id + ':ready' }); pendingReady = false; }
  }
  // A build started by the last thing in the log still gets its card.
  if (pendingReady) out.push({ role: 'ready', id: 'tail:ready' });
  return out;
}

// Has the live agent drifted from the code?
//
// The chat agent's system prompt AND its tool schemas live on Anthropic's
// servers, set by setup/update-agent.js. Editing lib/prompt.js or
// lib/editTools.js therefore changes NOTHING until somebody runs that script —
// there is no build step that does it, and a deploy will not.
//
// That has now cost two rounds of "I fixed it" followed by "it still does the
// old thing", which is the worst failure mode this project has: a change that
// looks shipped, reads shipped in the diff, and is inert. So it is checkable.
// One GET says whether what is running is what is written.
export async function agentDrift(agentId, system, tools) {
  try {
    const res = await fetchWith(API + '/v1/agents/' + agentId, T_READ, { headers: headers() });
    if (!res.ok) return 'could not read the agent (' + res.status + ')';
    const live = await res.json();
    const out = [];
    if ((live.system || '') !== system) out.push('prompt');
    // Compared by name and shape rather than deep equality on the whole array:
    // the toolset block is normalised server-side and would always differ.
    //
    // Keys are sorted before comparing. The API returns the same object with
    // its keys in a different order, and a plain JSON.stringify called every
    // tool stale on nothing but that — a check that always cries wolf is worse
    // than no check, because it teaches you to ignore it.
    const stable = (v) => (
      v === null || typeof v !== 'object' ? JSON.stringify(v)
        : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
          : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}');
    const shape = (t) => stable({ n: t.name, d: t.description, i: t.input_schema });
    const liveByName = new Map((live.tools || []).filter((t) => t.name).map((t) => [t.name, t]));
    for (const t of tools) {
      if (!t.name) continue;
      const l = liveByName.get(t.name);
      if (!l) { out.push('missing tool ' + t.name); continue; }
      if (shape(l) !== shape(t)) out.push('tool ' + t.name);
    }
    return out.length
      ? 'STALE v' + live.version + ' — run setup/update-agent.js chat (differs: ' + out.join(', ') + ')'
      : 'ok (v' + live.version + ')';
  } catch (err) {
    return String(err.message || err).slice(0, 160);
  }
}
