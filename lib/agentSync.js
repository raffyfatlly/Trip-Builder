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
  // Every container tool off, and no web search: the chat agent researches
  // through RESEARCH_TOOL, on our own server. See lib/research.js for why.
  { type: 'agent_toolset_20260401', default_config: { enabled: false } },
  RESEARCH_TOOL,
  BUILD_TOOL, READ_TOOL, EDIT_TOOL, PRESENT_TOOL, PROPOSE_TOOL, NOTE_TOOL,
  REMEMBER_TOOL, FORGET_TOOL,
  ...FACT_TOOLS,
  PRICE_TOOL,
];

// The builder is a second persisted agent with exactly the same trap. Its
// itinerary schema lives on the agent too, so a new field on a trip — arriveBy,
// say — does nothing until it is pushed. Same fix, same file.
const AGENTS = {
  chat: { id: CHAT_AGENT_ID, system: () => SYSTEM, tools: CHAT_TOOLS },
  builder: { id: BUILDER_AGENT_ID, system: () => BUILDER_SYSTEM, tools: () => BUILDER_TOOLS },
};

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

export const _reset = () => { for (const k of Object.keys(checked)) delete checked[k]; };
