// The persisted agent, kept in step with this repo automatically.
//
// raffy, 2026-09-07: "what command is that? are you asking me to do work?"
//
// He was right to push back. Tools and the system prompt live on the Managed
// Agent, not in the deploy, so shipping code that adds a tool did nothing until
// somebody ran `setup/update-chat-agent.js` by hand. That is a step nobody will
// remember at 2am, and the failure is silent and total: the agent keeps running
// the old tool list and simply cannot reach anything new. Every session between
// the deploy and the command is a session missing the fix.
//
// So the deployment does it. Before a chat session is created, check whether
// the live agent matches this code, and push it if it does not. One GET per
// cold start, a POST only when something actually changed.
//
// SAFETY OF DOING THIS AUTOMATICALLY:
//   - A session pins the agent version it started on, so an update never
//     disturbs a conversation already in flight.
//   - The body is derived from this repo, so two lambdas racing send the same
//     thing; a duplicate version bump is harmless.
//   - The model comes from a SETTING, so it can be changed without a deploy —
//     see chatModel() below. Everything else about the live model object is
//     read and sent back unchanged, so a deliberate change made from the CLI
//     is not quietly reverted.
//   - If anything fails, the session is created anyway. A stale agent is a
//     worse conversation; a failed session is no conversation at all.

import { fetchWith } from './net.js';
import { setting } from './settings.js';
import { agentDrift } from './managedAgents.js';
import { CHAT_AGENT_ID, BUILDER_AGENT_ID } from './config.js';
import { SYSTEM } from './prompt.js';
import { RESEARCH_TOOL } from './research.js';
import { BUILD_TOOL } from './brief.js';
import { READ_TOOL, EDIT_TOOL } from './editTools.js';
import { PRESENT_TOOL, PROPOSE_TOOL } from './blocks.js';
import { NOTE_TOOL } from './plan.js';
import { REMEMBER_TOOL, FORGET_TOOL } from './memory.js';
import { FACT_TOOLS } from './facts.js';
import { PRICE_TOOL } from './prices.js';
import { BUILDER_SYSTEM } from './builderPrompt.js';
import { TOOLS as BUILDER_TOOLS } from './schema.js';
import { FIND_TOOL } from './photos.js';

const API = 'https://api.anthropic.com';
const T = 20000;

// WHICH MODEL THE CHAT AGENT RUNS ON.
//
// raffy, 2026-09-07: "also change sonnet to haiku. let me see if it works
// nicely too." A setting rather than a constant precisely because that is a
// question you answer by trying it: flipping back is a config change, not a
// deploy, and the next session picks it up.
//
// Ids carry no date suffix — `claude-haiku-4-5`, never `claude-haiku-4-5-<date>`.
//
// STAYING ON HAIKU. raffy, 2026-09-07, after the first trial came back as prose
// instead of cards: "wait don't change to sonnet yet. make it haiku but make it
// get all the same tools!"
//
// He is right that the tool list is the thing to check first, and it is checked
// now rather than assumed — see CHAT_TOOLS below and the toolCheck() export at
// the bottom, which reads the LIVE agent and reports what it is actually
// carrying. The list sent up is model-independent: nothing here has ever varied
// by model, so a Haiku agent gets byte-identical tools to the Sonnet one.
//
// Flipping back is a config change, not a deploy — CHAT_MODEL in the
// environment, or chatModel in the config document.
export const chatModel = () => setting('CHAT_MODEL', 'chatModel', 'claude-haiku-4-5');

// EFFORT IS NOT UNIVERSAL, and sending it where it is unsupported is a 400.
//
// The agent has been running `effort: medium` since 2026-09-05, when it was on
// Sonnet. Haiku 4.5 does not take `effort` at all — it errors — so moving the
// model without dropping the field would have broken every conversation, and
// the failure would have looked like the model being bad rather than the
// request being malformed.
//
// Effort exists on the Opus/Sonnet 5 family and on Opus 4.5; it does not on
// Haiku 4.5 or Sonnet 4.5. Keeping this as a list of what DOES support it means
// an unknown model errs toward omitting the field, which is the safe direction.
const TAKES_EFFORT = /^claude-(opus|sonnet|fable|mythos)-(5|4-[5-9])/;

/** The model object to send, given whatever the live agent currently has. */
export function modelFor(live, id = chatModel()) {
  const out = { ...(live || {}), id };
  if (!TAKES_EFFORT.test(id)) delete out.effort;
  else if (!out.effort) out.effort = { type: 'medium' };
  return out;
}

const headers = () => ({
  'x-api-key': process.env.ANTHROPIC_API_KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'managed-agents-2026-04-01',
  'content-type': 'application/json',
});

// The same list setup/update-chat-agent.js sends. Exported so the CLI and this
// can never disagree about what the agent is supposed to have — two lists that
// drift apart would reintroduce exactly the problem this file exists to end.
export const CHAT_TOOLS = () => [
  // Container tools off — file ops and bash have no place in a chat about a
  // holiday — but WEB SEARCH AND WEB FETCH ON.
  //
  // raffy, 2026-09-07: "I just google double tree Hilton melaka rates date bla
  // bla and it gives out the prices with room across all platform. why cnt
  // anthropic do the same ... go with anthropic default tool to find."
  //
  // Because we had switched it off. The whole toolset was disabled and the
  // agent was made to research through RESEARCH_TOOL, which searches via a
  // worker on OpenRouter — that was the right call when the problem was web
  // results flooding the conversation's context, and it is the wrong call for
  // a price. He is describing exactly what a search engine already does well:
  // ask for a hotel and dates, get the rate per room across every platform.
  // Building a scraper to re-derive that was the mistake.
  //
  // These two run on Anthropic's servers, not in the session container, so the
  // environment's networking policy does not apply to them and there is
  // nothing to configure at that end.
  {
    type: 'agent_toolset_20260401',
    default_config: { enabled: false },
    configs: [
      {
        name: 'web_search',
        enabled: true,
        // Malaysia, so rates come back in ringgit and local sites rank — which
        // is the difference between his Google result and ours.
        user_location: {
          type: 'approximate',
          country: 'MY',
          timezone: 'Asia/Kuala_Lumpur',
        },
      },
      // Reading one page it found: the hotel's own rates page, a Google Hotels
      // listing, a booking page. This is what Firecrawl was doing, run by the
      // people who also run the model.
      { name: 'web_fetch', enabled: true },
    ],
  },
  RESEARCH_TOOL,
  BUILD_TOOL, READ_TOOL, EDIT_TOOL, PRESENT_TOOL, PROPOSE_TOOL, NOTE_TOOL,
  REMEMBER_TOOL, FORGET_TOOL,
  ...FACT_TOOLS,
  PRICE_TOOL,
];

// EVERY TOOL THE BUILDER ACTUALLY HAS, which is not what this file used to say.
//
// It listed BUILDER_TOOLS — the six itinerary ops out of schema.js — and left
// out find_photos and the web toolset, both of which setup/update-agent.js has
// always registered on the agent. Two consequences, and the second cost a day.
//
// The check reported drift for ever, because the live agent legitimately had
// tools this list did not, so the one signal that was supposed to say "the
// agent and the code disagree" said it every single time and meant nothing.
//
// And find_photos, the tool at the centre of the stuck builds, was outside the
// set this repo believed it owned — so no push, however it was triggered, could
// ever have corrected its schema on the agent. The builder went on sending
// `queries` as a string because the schema it holds says string, and this repo
// went on answering as though it were an array of objects.
//
// The builder is a second persisted agent with exactly the same trap as the
// chat one. Its itinerary schema lives on the agent, so a new field on a trip —
// arriveBy, say — does nothing until it is pushed.
export const BUILDER_TOOLSET = () => [
  {
    type: 'agent_toolset_20260401',
    default_config: { enabled: false },
    configs: [
      { name: 'web_search', enabled: true },
      { name: 'web_fetch', enabled: true },
    ],
  },
  FIND_TOOL,
  ...BUILDER_TOOLS,
];
const AGENTS = {
  chat: { id: CHAT_AGENT_ID, system: () => SYSTEM, tools: CHAT_TOOLS },
  builder: { id: BUILDER_AGENT_ID, system: () => BUILDER_SYSTEM, tools: BUILDER_TOOLSET },
};

// HANDS OFF THE AGENT UNTIL HE SAYS OTHERWISE.
//
// raffy, 2026-09-07: "don't change any setting on my agent for now. i like how
// it works ... I manually enable all tools for the agent from anthropic console.
// idk why u custom it. it's fine."
//
// He edited the agent in the Console. This file's whole job is to push this
// repo's prompt and tools over whatever is live, on the next cold start — so
// left alone it would have silently reverted his change within minutes, and the
// revert would have looked like the Console not saving.
//
// So the push is off by default. The CHECK still runs and still reports drift,
// because knowing the deployed code and the live agent disagree is useful; it
// just does not act on it. Turn it back on with AGENT_SYNC=on in the
// environment or agentSync: "on" in the config document — one setting, no
// deploy — when he wants the repo to own the agent again.
//
// The trap this was built to close has not gone away: a tool added in code does
// nothing until it is pushed. The answer to that now is `?syncagent=1` on the
// health endpoint, which is deliberate and explicit, rather than a deploy doing
// it behind him.
const syncOn = () => setting('AGENT_SYNC', 'agentSync', 'off').toLowerCase() === 'on';

// One check per warm lambda, per agent. A cold start pays a single GET;
// everything after it on the same instance pays nothing.
const checked = {};

async function syncOne(which, { force = false } = {}) {
  const spec = AGENTS[which];
  if (!spec) return 'unknown agent';
  if (checked[which] && !force) return checked[which];
  const run = (async () => {
    if (!process.env.ANTHROPIC_API_KEY) return 'no key';
    try {
      const drift = await agentDrift(spec.id, spec.system(), spec.tools().filter((t) => t.name));

      // Read the live agent before deciding: the MODEL can be stale even when
      // the prompt and tools match, and agentDrift only compares those two.
      const cur = await fetchWith(API + '/v1/agents/' + spec.id, T, { headers: headers() });
      if (!cur.ok) return drift.startsWith('STALE') ? 'could not read agent (' + cur.status + ')' : drift;
      const live = await cur.json();

      const want = which === 'chat' ? modelFor(live.model) : (live.model || {});
      const modelStale = which === 'chat'
        && JSON.stringify(want) !== JSON.stringify(live.model || {});
      if (!drift.startsWith('STALE') && !modelStale) return drift;

      // Drift found — and unless pushing is switched on, that is where it ends.
      // Reporting it is useful; overwriting somebody's Console edit is not.
      if (!force && !syncOn()) {
        return 'drift, not pushed (AGENT_SYNC is off): ' + drift
          + (modelStale ? ' + model' : '');
      }

      const res = await fetchWith(API + '/v1/agents/' + spec.id, T, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ system: spec.system(), tools: spec.tools(), model: want }),
      });
      if (!res.ok) return 'update failed (' + res.status + ' ' + (await res.text()).slice(0, 200) + ')';
      const after = await res.json();
      console.log('agentSync: pushed ' + which + ' agent v' + after.version
        + ' on ' + ((after.model || {}).id || '?') + ' (' + drift + ')');
      return 'updated to v' + after.version + ' on ' + ((after.model || {}).id || '?');
    } catch (err) {
      // Never a reason to fail a session. See the note at the top.
      return String((err && err.message) || err).slice(0, 160);
    }
  })();
  checked[which] = run;
  return run;
}

/**
 * Push ONLY the prompt, leaving the live tools and model exactly as they are.
 *
 * raffy, 2026-09-07: "don't change anything technical like model or tools. it's
 * working perfectly fine now. it knows the how, just what need to be adjusted."
 *
 * That is a precise instruction and the full sync cannot honour it: syncOne()
 * sends system, tools and model together, so pushing a reworded prompt would
 * also revert the tools he enabled in the Console. This reads the live agent and
 * sends its own tools and model straight back, changing one field.
 *
 * It still creates a new agent version — that is how the platform works — but
 * the only thing that differs is the wording.
 */
// One push per warm lambda. New sessions are rare enough that a GET each time
// would be harmless, but there is no reason to pay for it twice on the same box.
let promptPushed = null;
export function pushPromptOnce() {
  if (!promptPushed) promptPushed = pushPrompt();
  return promptPushed;
}

/**
 * The live tools, with the ones this repo owns brought up to date.
 *
 * A SCHEMA CHANGE IN THIS FILE HAS TO BE ABLE TO REACH THE AGENT.
 *
 * pushPrompt sent `live.tools` back verbatim, which protected everything raffy
 * set in the Console and quietly meant the tool DEFINITIONS here were dead
 * code. 2026-09-08 is what that costs: `check_prices` grew a `style` field so
 * the agent could ask for "luxury hotel in Venice" rather than "Venice", the
 * prompt was updated to tell it to send one — and the live tool would have gone
 * on rejecting the field, so the instruction was to do something impossible.
 * Exactly the shape of the stale-prompt bug this function exists to prevent,
 * one layer down.
 *
 * So: matched BY NAME. A tool this repo defines is replaced with its current
 * definition; anything else on the live agent is passed through untouched, and
 * nothing is ever removed. Whatever he added in the Console stays added.
 */
export function mergeTools(liveTools, ours = CHAT_TOOLS()) {
  const nameOf = (t) => (t && (t.name || t.type)) || '';
  const mine = new Map(ours.map((t) => [nameOf(t), t]));
  const out = (liveTools || []).map((t) => mine.get(nameOf(t)) || t);
  // A tool added here and not yet on the agent would otherwise never arrive.
  const have = new Set(out.map(nameOf));
  for (const [n, t] of mine) if (!have.has(n)) out.push(t);
  return out;
}

export async function pushPrompt() {
  if (!process.env.ANTHROPIC_API_KEY) return 'no key';
  try {
    const cur = await fetchWith(API + '/v1/agents/' + CHAT_AGENT_ID, T, { headers: headers() });
    if (!cur.ok) return 'could not read agent (' + cur.status + ')';
    const live = await cur.json();
    if ((live.system || '') === SYSTEM) return 'prompt already matches (v' + live.version + ')';
    const res = await fetchWith(API + '/v1/agents/' + CHAT_AGENT_ID, T, {
      method: 'POST',
      headers: headers(),
      // live.model verbatim, and the tools MERGED — see mergeTools.
      body: JSON.stringify({ system: SYSTEM, tools: mergeTools(live.tools), model: live.model }),
    });
    if (!res.ok) return 'push failed (' + res.status + ' ' + (await res.text()).slice(0, 200) + ')';
    const after = await res.json();
    // Against what we MEANT to send, not against what was there before: the
    // tools are supposed to change now when a schema here has.
    const same = JSON.stringify(after.tools) === JSON.stringify(mergeTools(live.tools))
      && JSON.stringify(after.model) === JSON.stringify(live.model);
    const moved = JSON.stringify(after.tools) !== JSON.stringify(live.tools);
    return 'prompt pushed as v' + after.version
      + (same
        ? ', tools ' + (moved ? 'updated from this repo' : 'unchanged') + ', model untouched'
        : ' — WARNING: the agent did not take the tools or model we sent');
  } catch (err) {
    return String((err && err.message) || err).slice(0, 200);
  }
}

/**
 * The same push, for the BUILDER agent — which had never had one.
 *
 * raffy, 2026-09-09: "why don't u check the build agents too."
 *
 * That was the question that ended a day of chasing. The builder's find_photos
 * kept arriving as `{"queries": "[\"a\", \"b\"]"}` — a string where the code
 * expects an array of objects — and every fix so far treated that as the model
 * being sloppy. It is not. THE LIVE AGENT CARRIES ITS OWN TOOL SCHEMAS, and
 * nothing has ever pushed the builder's: pushPrompt only touches the chat
 * agent, and syncBuilderAgent reports drift without acting on it because the
 * push is off by default. So the builder has been obeying whatever schema was
 * last set by hand, faithfully, while this repo answered it from a different
 * one. Neither side was wrong on its own terms and the two could never agree.
 *
 * The builder is not the agent he customised in the Console — that note was
 * about the chat agent's toolset — and its tools ARE the itinerary schema, so
 * they have to match the code or a new field on a trip simply never arrives.
 * Merged by name like the chat agent's: ours replace ours, anything else stays.
 */
let builderPushed = null;
export function pushBuilderOnce() {
  if (!builderPushed) builderPushed = pushBuilder();
  return builderPushed;
}

export async function pushBuilder() {
  if (!process.env.ANTHROPIC_API_KEY) return 'no key';
  try {
    const cur = await fetchWith(API + '/v1/agents/' + BUILDER_AGENT_ID, T, { headers: headers() });
    if (!cur.ok) return 'could not read builder (' + cur.status + ')';
    const live = await cur.json();
    const tools = mergeTools(live.tools, BUILDER_TOOLSET());
    const sameSystem = (live.system || '') === BUILDER_SYSTEM;
    const sameTools = JSON.stringify(tools) === JSON.stringify(live.tools);
    if (sameSystem && sameTools) return 'builder already matches (v' + live.version + ')';
    const res = await fetchWith(API + '/v1/agents/' + BUILDER_AGENT_ID, T, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ system: BUILDER_SYSTEM, tools, model: live.model }),
    });
    if (!res.ok) return 'builder push failed (' + res.status + ' ' + (await res.text()).slice(0, 200) + ')';
    const after = await res.json();
    return 'builder pushed as v' + after.version
      + (sameSystem ? '' : ', prompt updated')
      + (sameTools ? '' : ', tools updated from this repo');
  } catch (err) {
    return String((err && err.message) || err).slice(0, 200);
  }
}

export const syncChatAgent = () => syncOne('chat');
export const syncBuilderAgent = () => syncOne('builder');

/** Both, reported side by side. For the health endpoint. */
export async function syncAgents(opts) {
  const [chat, builder] = await Promise.all([syncOne('chat', opts), syncOne('builder', opts)]);
  return { chat, builder };
}

/**
 * WHAT THE LIVE CHAT AGENT IS ACTUALLY CARRYING.
 *
 * raffy, 2026-09-07: "make it haiku but make it get all the same tools!"
 *
 * Until now the only answer to that was "the code sends them, so it has them",
 * which is the same reasoning that let the stale-agent problem run for weeks.
 * The agent is a server-side object; the honest answer comes from reading it.
 *
 * Reports the live model, the tool names it holds, and — the part that matters
 * — anything this repo defines that the agent does NOT have, and anything the
 * agent has that this repo no longer defines. Read-only: it changes nothing.
 */
export async function toolCheck() {
  if (!process.env.ANTHROPIC_API_KEY) return { error: 'no key' };
  try {
    const res = await fetchWith(API + '/v1/agents/' + CHAT_AGENT_ID, T, { headers: headers() });
    if (!res.ok) return { error: 'read failed (' + res.status + ')' };
    const live = await res.json();
    const nameOf = (t) => t.name || t.type || '?';
    const have = (live.tools || []).map(nameOf);
    const want = CHAT_TOOLS().map(nameOf);
    return {
      version: live.version,
      model: (live.model || {}).id || '?',
      effort: (live.model || {}).effort ? (live.model || {}).effort.type : null,
      count: have.length,
      tools: have,
      missing: want.filter((n) => !have.includes(n)),
      extra: have.filter((n) => !want.includes(n)),
      // A prompt that no longer matches is the other half of the same question.
      promptInSync: (live.system || '') === SYSTEM,
    };
  } catch (err) {
    return { error: String((err && err.message) || err).slice(0, 200) };
  }
}

export const _reset = () => {
  for (const k of Object.keys(checked)) delete checked[k];
  promptPushed = null;
};
