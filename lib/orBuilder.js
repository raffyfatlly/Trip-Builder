// The builder, running on OpenRouter instead of Managed Agents.
//
// raffy, 2026-08-31: "use my open router api. use glm 5.3 for both agents."
//
// Only the builder moves, and the reason it can is that it stopped researching
// this morning. It used to be a genuine agent — web search, several turns of
// looking things up, judgement about what to include. That needs the Managed
// Agents runtime: hosted search, a session, an event log. What it is NOW is a
// formatting pass: read a brief that already contains the research, emit the
// JSON. A plain chat-completions API does that perfectly well, and it is the
// expensive half — a build costs roughly fifty times a chat turn.
//
// The chat agent stays where it is. It still needs live search, the
// interactive tool loop, and the session log that everything else replays from.
//
// State lives in Firestore rather than in a session event log, because a build
// outlives a serverless function. Same shape as before: each poll advances the
// work a bounded amount and returns.

import { TOOLS } from './schema.js';
import { applyEdit, resultFor, TOOL_NAMES } from './itinerary.js';
import { FIND_TOOL, findPhotos } from './photos.js';
import { fetchWith } from './net.js';

// A build step is one model call writing a large itinerary, so it legitimately
// takes a while — but not forever. Past this it is stuck, not slow.
const T_MODEL = 120000;
import { BUILDER_SYSTEM } from './builderPrompt.js';
import { firestoreConfigured, readBuild, writeBuild } from './firestore.js';

const API = 'https://openrouter.ai/api/v1/chat/completions';

export const MODEL = () => process.env.OPENROUTER_MODEL || 'z-ai/glm-5.3';
const KEY = () => process.env.OPENROUTER_API_KEY;

// Only used when there is both a key and somewhere to keep the conversation.
// Without either, builds fall back to the Managed Agents builder untouched.
export const orBuilderReady = () => !!(KEY() && firestoreConfigured());

// A build should not be able to run away with his money. These are generous
// for a formatting pass and cheap insurance against a loop that will not end.
const MAX_STEPS = 14;

// Anthropic's custom-tool shape into OpenAI's function shape. Same schemas,
// different envelope — worth doing here rather than maintaining two copies of
// the itinerary schema, which would drift within a week.
const asFunctions = (tools) => tools.map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

const TOOLSET = asFunctions([...TOOLS, FIND_TOOL]);

async function chat(messages) {
  const res = await fetchWith(API, T_MODEL, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + KEY(),
      'content-type': 'application/json',
      // OpenRouter attributes traffic with these; harmless and it keeps the
      // dashboard readable when something goes wrong.
      'http-referer': 'https://trip-builder-two.vercel.app',
      'x-title': 'Trip Builder',
    },
    body: JSON.stringify({
      model: MODEL(),
      messages,
      tools: TOOLSET,
      tool_choice: 'auto',
      max_tokens: 32000,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('openrouter ' + res.status + ' ' + text.slice(0, 300));
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('openrouter sent no JSON'); }
  // OpenRouter reports upstream failures inside a 200, so check before reading.
  if (data.error) throw new Error('openrouter: ' + (data.error.message || JSON.stringify(data.error)).slice(0, 200));
  const choice = (data.choices || [])[0];
  if (!choice) throw new Error('openrouter returned no choices');
  return { message: choice.message || {}, finish: choice.finish_reason, usage: data.usage || null };
}

// Answer one tool call. The itinerary tools are pure — they fold into the
// state we are already carrying — and find_photos reaches the network.
async function answer(call, state) {
  const name = call.function && call.function.name;
  let input = {};
  // Models vary in how they escape JSON in arguments, so parse rather than
  // pattern-match, and treat unparseable arguments as a tool error the model
  // can recover from rather than as a crash.
  try { input = JSON.parse((call.function && call.function.arguments) || '{}'); }
  catch (e) { return { state, text: 'Your arguments were not valid JSON. Send the call again.' }; }

  if (name === 'find_photos') {
    try { return { state, text: await findPhotos(input.queries || []) }; }
    catch (err) { return { state, text: 'Photo search failed: ' + err.message + '. Carry on without photos.' }; }
  }
  if (!TOOL_NAMES.includes(name)) return { state, text: 'Unknown tool.' };

  const next = applyEdit(state, name, input);
  return { state: next, text: resultFor(name, next) };
}

// Start a build. Returns the id the chat log carries, exactly as the builder
// session id used to be.
export async function startBuild(briefText) {
  const id = 'orb_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  await writeBuild(id, {
    messages: [
      { role: 'system', content: BUILDER_SYSTEM + '\n\n' + NO_SEARCH },
      { role: 'user', content: briefText },
    ],
    itinerary: null,
    steps: 0,
    done: false,
    error: '',
  });
  return id;
}

// This builder has no web search, and saying so plainly is better than letting
// it wish for one. The brief is meant to carry the research now anyway.
const NO_SEARCH = `You have NO web search and NO web fetch in this run. Everything you need is in the brief.

Where the brief leaves a gap, write it as unknown and put it in trip.notes so the traveller checks it. Never invent a price, a time or an address to fill a hole — a stated unknown is useful, a confident guess is a trap.

find_photos still works: it searches for you and returns checked URLs.`;

// Look at a build without touching it.
//
// The read path must never make a model call. /api/state used to advance the
// build twice per poll, which is up to two GLM calls plus their tool work — so
// the poll that renders the page could take longer than Vercel allows, and the
// page stayed blank while the agent was perfectly fine. Reading is now free.
export async function peekBuild(id) {
  const b = await readBuild(id);
  if (!b) return { itinerary: null, building: false, error: 'That build could not be found.' };
  return {
    itinerary: b.itinerary || null,
    building: !b.done && !b.error && b.steps < MAX_STEPS,
    error: b.error || '',
  };
}

// Advance one build by one model call. Returns the current view of it.
export async function advanceBuild(id) {
  const b = await readBuild(id);
  if (!b) return { itinerary: null, building: false, error: 'That build could not be found.' };
  if (b.done || b.error) return { itinerary: b.itinerary, building: false, error: b.error || '' };

  if (b.steps >= MAX_STEPS) {
    await writeBuild(id, { ...b, done: true, error: b.itinerary ? '' : 'The builder ran too long.' });
    return { itinerary: b.itinerary, building: false, error: b.itinerary ? '' : 'The builder ran too long.' };
  }

  let out;
  try {
    out = await chat(b.messages);
  } catch (err) {
    // One failure is not fatal — the next poll retries. Only a repeated one
    // ends the build, which MAX_STEPS takes care of.
    await writeBuild(id, { ...b, steps: b.steps + 1 });
    return { itinerary: b.itinerary, building: true, error: '' };
  }

  const msg = out.message;
  const calls = msg.tool_calls || [];
  const messages = [...b.messages, {
    role: 'assistant',
    content: msg.content || '',
    ...(calls.length ? { tool_calls: calls } : {}),
  }];

  let state = b.itinerary;
  for (const call of calls) {
    const r = await answer(call, state);
    state = r.state;
    messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: r.text });
  }

  // No tool calls means it has said its piece. If an itinerary exists that is
  // a finished build; if not, it answered in prose instead of calling the
  // tool, so push it once rather than failing silently.
  let done = false;
  if (!calls.length) {
    if (state) done = true;
    else messages.push({ role: 'user', content: 'You have not called save_itinerary yet. Do that now — the whole itinerary in one call. Do not reply in prose.' });
  }

  const next = {
    messages, itinerary: state, steps: b.steps + 1, done,
    error: '',
    usage: out.usage || b.usage || null,
  };
  await writeBuild(id, next);
  return { itinerary: state, building: !done, error: '' };
}
