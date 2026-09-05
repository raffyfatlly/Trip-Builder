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
import { setting, loadConfig } from './settings.js';

const API = 'https://openrouter.ai/api/v1/chat/completions';

// Which model, and which provider — without a deploy.
//
// raffy, 2026-09-05: "switch to sonnet for now and openrouter v3."
//
// The chat half was already Sonnet: both Managed Agents agents have run
// claude-sonnet-5 since 2026-08-31, so there was nothing to switch there. The
// half that changes is this one.
//
// Both settings read the environment first and the stored config document
// second, so the provider can be flipped by writing one Firestore field rather
// than finding a dashboard. See lib/settings.js.
export const MODEL = () => setting('OPENROUTER_MODEL', 'openrouterModel', DEFAULT_MODEL);
const KEY = () => setting('OPENROUTER_API_KEY', 'openrouterKey');

// The slug DeepSeek v3 is published under on OpenRouter — and the one thing
// here that could not be checked from the machine it was written on, because
// openrouter.ai is blocked by this sandbox's egress proxy. resolveModel()
// covers the case where it is wrong: it asks OpenRouter what it actually has
// and corrects itself once, rather than failing every build until somebody
// notices.
const DEFAULT_MODEL = 'deepseek/deepseek-chat-v3-0324';

// A corrected slug, remembered for the life of the function instance so the
// lookup happens once rather than once per build.
let RESOLVED = '';

/**
 * Ask OpenRouter for the real slug when the configured one is not a model.
 *
 * Only ever called after a 404, which is the one response that means "no such
 * model here". Rate limits, credit and outages are different problems and must
 * not silently change which model runs.
 *
 * Returns '' when it cannot do better, and the caller then reports the original
 * failure rather than inventing a substitute.
 */
export async function resolveModel(want) {
  if (RESOLVED) return RESOLVED;
  const key = KEY();
  if (!key) return '';
  try {
    const res = await fetchWith('https://openrouter.ai/api/v1/models', 15000, {
      headers: { authorization: 'Bearer ' + key },
    });
    if (!res.ok) return '';
    const ids = ((await res.json()).data || []).map((m) => String(m.id || '')).filter(Boolean);
    if (!ids.length) return '';

    const vendor = String(want).split('/')[0] || 'deepseek';
    // Not a free, preview or experimental variant unless there is nothing else:
    // those are rate-limited or get withdrawn, and a builder that silently
    // moves onto one is a support question later.
    const solid = (id) => !/:free|:extended|preview|-exp/i.test(id);
    const mine = ids.filter((id) => id.startsWith(vendor + '/'));
    const pick =
      ids.find((id) => id === want)
      || mine.filter((id) => /v3/i.test(id) && solid(id)).sort().pop()
      || mine.filter((id) => /v3/i.test(id)).sort().pop()
      || '';
    if (pick) RESOLVED = pick;
    return pick;
  } catch (err) {
    return '';
  }
}

/**
 * Does the configured model actually exist on OpenRouter, and what does it cost?
 *
 * The slug was written from a machine that cannot reach openrouter.ai, so
 * "verified" was not available at the time. This makes it one GET from the
 * deployment that can — the same reasoning as health's ?sources=1, and the
 * only honest way to answer it.
 *
 * Reads the catalogue; sends no completion, so it costs nothing.
 */
export async function builderProbe() {
  const want = MODEL();
  const key = KEY();
  if (!key) return { model: want, ok: false, why: 'no OpenRouter key on this deployment' };
  try {
    const res = await fetchWith('https://openrouter.ai/api/v1/models', 15000, {
      headers: { authorization: 'Bearer ' + key },
    });
    if (!res.ok) return { model: want, ok: false, why: 'models list said ' + res.status };
    const all = ((await res.json()).data || []);
    const hit = all.find((m) => String(m.id) === want);
    if (hit) {
      const p = hit.pricing || {};
      return {
        model: want,
        ok: true,
        // OpenRouter quotes per token; per million is the unit everything else
        // in this app is priced in.
        usdPerMillion: { in: +(Number(p.prompt || 0) * 1e6).toFixed(4), out: +(Number(p.completion || 0) * 1e6).toFixed(4) },
        context: hit.context_length || null,
      };
    }
    const alt = await resolveModel(want);
    return { model: want, ok: false, why: 'not in the catalogue', wouldUse: alt || 'nothing close',
      candidates: all.map((m) => String(m.id)).filter((id) => id.startsWith('deepseek/')).sort() };
  } catch (err) {
    return { model: want, ok: false, why: String(err && err.message || err).slice(0, 120) };
  }
}

/**
 * What OpenRouter has, and what it charges.
 *
 * Same reasoning as builderProbe: openrouter.ai is unreachable from the machine
 * this app is written on, so choosing a model there means either guessing at
 * prices or asking the deployment that can reach it. This asks.
 *
 * `q` filters by id substring. Returns the catalogue rows that matter for
 * picking a worker model: price per million, context, and whether it can use
 * tools at all — a research worker that cannot call a tool is not a candidate,
 * however cheap it is.
 */
export async function modelSearch(q, limit = 14) {
  const key = KEY();
  if (!key) return { error: 'no OpenRouter key on this deployment' };
  try {
    const res = await fetchWith('https://openrouter.ai/api/v1/models', 20000, {
      headers: { authorization: 'Bearer ' + key },
    });
    if (!res.ok) return { error: 'models list said ' + res.status };
    const want = String(q || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
    const rows = ((await res.json()).data || [])
      .filter((m) => !want.length || want.some((w) => String(m.id).toLowerCase().includes(w)))
      .map((m) => {
        const p = m.pricing || {};
        const sp = m.supported_parameters || [];
        return {
          id: m.id,
          in: +(Number(p.prompt || 0) * 1e6).toFixed(3),
          out: +(Number(p.completion || 0) * 1e6).toFixed(3),
          ctx: m.context_length || null,
          tools: sp.includes('tools'),
        };
      })
      .filter((m) => m.out > 0)
      .sort((a, b) => a.out - b.out)
      .slice(0, limit);
    return { count: rows.length, rows };
  } catch (err) {
    return { error: String(err && err.message || err).slice(0, 120) };
  }
}

// Which builder runs.
//
// It was moved to Managed Agents on 2026-09-05 morning while three real
// failures were fixed: compact() was compacting what got STORED rather than
// what got sent, save_itinerary could shrink a trip it had already written, and
// an empty answer was pushed back forever instead of being counted and bailed
// on. All three are fixed and tested.
//
// raffy, 2026-09-05, after seeing the bill: "switch to sonnet for now and
// openrouter v3." So it goes back, on DeepSeek rather than GLM.
const BUILDER = () => setting('BUILDER', 'builder', 'managed').toLowerCase();

/**
 * Is the OpenRouter builder the one that should run?
 *
 * Async because the answer lives in the config document, and a cold function
 * that guessed "managed" would quietly send somebody's build to the provider
 * he has just moved off. One Firestore read per five minutes.
 */
export async function orBuilderReady() {
  await loadConfig();
  return BUILDER() === 'openrouter' && !!(KEY() && firestoreConfigured());
}

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

async function chat(messages, model) {
  const use = model || MODEL();
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
      model: use,
      messages,
      tools: TOOLSET,
      tool_choice: 'auto',
      max_tokens: 32000,
      // Ask for the real figure. Without this the response carries token counts
      // and no money, and pricing a build from a rate table means guessing at
      // whatever the router paid the provider that minute.
      usage: { include: true },
    }),
  });
  const text = await res.text();
  // 404 is the one status that means "no such model here". The configured slug
  // could not be verified when it was written — openrouter.ai is unreachable
  // from the sandbox — so ask what the catalogue actually holds and retry once
  // rather than failing every build until somebody reads a log.
  if (res.status === 404 && !model) {
    const real = await resolveModel(use);
    if (real && real !== use) return chat(messages, real);
  }
  if (!res.ok) throw new Error('openrouter ' + res.status + ' ' + text.slice(0, 300));
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('openrouter sent no JSON'); }
  // OpenRouter reports upstream failures inside a 200, so check before reading.
  if (data.error) throw new Error('openrouter: ' + (data.error.message || JSON.stringify(data.error)).slice(0, 200));
  const choice = (data.choices || [])[0];
  if (!choice) throw new Error('openrouter returned no choices');
  // usage.cost is what OpenRouter actually charged, in USD — asked for above.
  // It is handed back rather than metered here: the builder's money and its
  // token counts have to be written by the same caller, or the estimate and the
  // real figure both land on the row and the build looks twice as expensive as
  // it was.
  return { message: choice.message || {}, finish: choice.finish_reason, usage: data.usage || null,
    model: data.model || use };
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
  // applyEdit refuses a save that would shrink the trip. Saying so is what stops
  // the model trying the same thing again for the rest of its budget.
  if (name === 'save_itinerary' && next === state && state) {
    return { state, text: 'Not applied. That would have replaced a ' +
      (state.days || []).length + '-day itinerary with a shorter one, and save_itinerary ' +
      'replaces rather than merges. The trip is already saved and showing. Use update_day ' +
      'with an index to change one day, update_trip to change the trip, add_idea to add an ' +
      'idea, and find_photos / add_photos for pictures.' };
  }
  return { state: next, text: resultFor(name, next) };
}

// Arguments that have already been applied are history, and expensive history.
//
// save_itinerary carries the whole trip — thirty to fifty kilobytes — and every
// call after it re-sends that. Real builds reached 87kB of conversation and two
// of eight ran out of steps before they finished. Once an edit is applied the
// itinerary lives in the build document, and the model gets the index back in
// every tool result (see digest in lib/itinerary.js), so the arguments are
// nothing but a bill.
//
// The call itself stays — same id, same name — because a tool result must still
// have an assistant tool_call to answer to.
const HEAVY = ['save_itinerary', 'update_day', 'update_stay', 'add_idea', 'add_photos'];

export function compact(messages) {
  return (messages || []).map((m) => {
    if (!m || !m.tool_calls || !m.tool_calls.length) return m;
    return {
      ...m,
      tool_calls: m.tool_calls.map((c) => {
        const name = (c.function || {}).name;
        if (!HEAVY.includes(name)) return c;
        const args = (c.function || {}).arguments || '';
        if (args.length < 400) return c;                 // already small
        return { ...c, function: { ...c.function, arguments: '{"applied":true}' } };
      }),
    };
  });
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
    // Real counts, so a progress bar can be a fact rather than an animation
    // that means nothing. raffy: "if there's a progress bar or something that
    // would be perfect."
    step: b.steps || 0,
    steps: MAX_STEPS,
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
    // Compacted on the way out as well as on the way in. Doing it only when the
    // next state was written meant each heavy call was still sent in full once,
    // which is most of the saving but by accident rather than by design.
    out = await chat(compact(b.messages));
  } catch (err) {
    // One failure is not fatal — the next poll retries. Only a repeated one
    // ends the build, which MAX_STEPS takes care of.
    await writeBuild(id, { ...b, steps: b.steps + 1 });
    return { itinerary: b.itinerary, building: true, error: '' };
  }

  const msg = out.message;
  const calls = msg.tool_calls || [];
  // A tool call cut off at max_tokens arrives as unparseable arguments, and the
  // only thing that says so is the finish reason — which nothing was reading.
  if (out.finish === 'length' && !calls.length) {
    console.error('builder ' + id + ' step ' + b.steps + ' hit the token ceiling with nothing to apply');
  }
  const messages = [...compact(b.messages), {
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
  // a finished build; if not, it answered in prose instead of calling the tool,
  // so push it once rather than failing silently.
  //
  // Unless it said nothing at all. One real build got eight consecutive replies
  // with no text and no tool call, and was pushed back eight times for an
  // itinerary it was never going to write — which is most of what raffy meant by
  // "taking really really really long". An empty answer is a failure, and three
  // of them is a broken build, not a slow one.
  let done = false;
  let empty = b.empty || 0;
  if (!calls.length) {
    const said = String(msg.content || '').trim();
    if (state) done = true;
    else if (!said) {
      empty++;
      if (empty >= 3) {
        await writeBuild(id, { ...b, steps: b.steps + 1, done: true,
          error: 'The builder stopped answering. Try building again.' });
        return { itinerary: null, building: false,
          error: 'The builder stopped answering. Try building again.', model: MODEL() };
      }
      messages.push({ role: 'user', content: 'You replied with nothing at all. Call save_itinerary now with the whole trip.' });
    } else {
      messages.push({ role: 'user', content: 'You have not called save_itinerary yet. Do that now — the whole itinerary in one call. Do not reply in prose.' });
    }
  } else { empty = 0; }

  const next = {
    messages, itinerary: state, steps: b.steps + 1, done, empty,
    error: '',
    usage: out.usage || b.usage || null,
  };
  await writeBuild(id, next);
  // The step's usage goes back to the caller rather than being summed here:
  // writeBuild does not persist `usage`, so a running total kept on the build
  // document would reset on the next read. lib/journal.js adds it up instead,
  // where it is written down.
  return { itinerary: state, building: !done, error: '', usage: out.usage || null,
    // What OpenRouter says it ran, not what we asked for: resolveModel() can
    // substitute a slug, and a cost row naming the wrong model is worse than
    // no row at all.
    model: out.model || MODEL(),
    // What this step had to carry. Written into the journal on the last step so
    // a real build says out loud whether the conversation is running away
    // again — the thing that put two of eight builds into the step ceiling.
    kb: Math.round(JSON.stringify(messages).length / 1024) };
}
