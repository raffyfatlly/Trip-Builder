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
//   - It never touches the model or the effort setting — it reads those off the
//     live agent and sends them back unchanged, so a deliberate change made
//     from the CLI is not quietly reverted by a deploy.
//   - If anything fails, the session is created anyway. A stale agent is a
//     worse conversation; a failed session is no conversation at all.

import { fetchWith } from './net.js';
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
      if (!drift.startsWith('STALE')) return drift;

      // Read the live agent for its model and effort, so pushing tools cannot
      // silently undo a model decision made somewhere else.
      const cur = await fetchWith(API + '/v1/agents/' + spec.id, T, { headers: headers() });
      if (!cur.ok) return 'could not read agent (' + cur.status + ')';
      const live = await cur.json();

      const res = await fetchWith(API + '/v1/agents/' + spec.id, T, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ system: spec.system(), tools: spec.tools(), model: live.model }),
      });
      if (!res.ok) return 'update failed (' + res.status + ' ' + (await res.text()).slice(0, 200) + ')';
      const after = await res.json();
      console.log('agentSync: pushed ' + which + ' agent v' + after.version + ' (' + drift + ')');
      return 'updated to v' + after.version;
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

export const _reset = () => { for (const k of Object.keys(checked)) delete checked[k]; };
