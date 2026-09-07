// Push the chat agent's current prompt and tools to the live agent.
//
// create-agent.js makes NEW agents, which mints new ids and orphans the ones
// lib/config.js pins. This updates the one that is actually running, in place,
// and bumps its version — which is what you want for a prompt or tool change.
//
//   node --env-file=.env setup/update-chat-agent.js [--dry]

import { SYSTEM } from '../lib/prompt.js';
import { BUILD_TOOL } from '../lib/brief.js';
import { READ_TOOL, EDIT_TOOL } from '../lib/editTools.js';
import { PRESENT_TOOL, PROPOSE_TOOL } from '../lib/blocks.js';
import { NOTE_TOOL } from '../lib/plan.js';
import { REMEMBER_TOOL, FORGET_TOOL } from '../lib/memory.js';
import { FACT_TOOLS } from '../lib/facts.js';
import { PRICE_TOOL } from '../lib/prices.js';
import { RESEARCH_TOOL } from '../lib/research.js';
import { CHAT_AGENT_ID } from '../lib/config.js';
import { CHAT_TOOLS, modelFor, chatModel } from '../lib/agentSync.js';

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) throw new Error('ANTHROPIC_API_KEY not set');

const H = {
  'x-api-key': KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'managed-agents-2026-04-01',
  'content-type': 'application/json',
};

// One list, in lib/agentSync.js, shared with the deployment that now pushes
// this automatically. Two copies of it would drift, and a tool list that
// disagrees with itself is the exact failure this script exists to fix.
const tools = CHAT_TOOLS();

const before = await (await fetch('https://api.anthropic.com/v1/agents/' + CHAT_AGENT_ID, { headers: H })).json();
console.log('now      v' + before.version + '  ' + (before.model || {}).id
  + '  effort ' + (((before.model || {}).effort || {}).type || '?')
  + '  ' + (before.tools || []).length + ' tool entries');

const names = tools.map((t) => t.name || t.type);
console.log('sending  ' + names.length + ' tool entries: ' + names.join(', '));

if (process.argv.includes('--dry')) {
  console.log('\n(dry run, nothing sent)');
  process.exit(0);
}

// Effort, as well as prompt and tools.
//
// raffy, 2026-09-05: "chat is still expensive in general. lets work on it
// further if possible."
//
// Measured on his Madura trip, the $0.63 chat splits: cache writes 43%, output
// 35%, cache reads 21%. Managed Agents does its own prompt caching and exposes
// no TTL, so the write half is the platform's to spend — but the output half is
// ours, and it was running at effort `high`.
//
// A travel conversation is judgement, not hard reasoning: which hotel suits
// these two, is this day too full. Anthropic's own guidance puts chat among the
// workloads that do not repay high effort. `medium` is the step down to try
// first, and it cuts the wait as well as the bill.
//
// Set EFFORT=high to put it back in one command if the conversation gets worse.
// Effort is not universal: Haiku 4.5 rejects it outright. modelFor() knows
// which families take it, so the CLI and the deployment cannot disagree about
// what a valid model object looks like.
const wantModel = modelFor(before.model, process.env.CHAT_MODEL || chatModel());
if (process.env.EFFORT && wantModel.effort) wantModel.effort = { type: process.env.EFFORT };
console.log('model    ' + wantModel.id
  + (wantModel.effort ? '  effort ' + wantModel.effort.type : '  (no effort on this model)'));

const res = await fetch('https://api.anthropic.com/v1/agents/' + CHAT_AGENT_ID, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    system: SYSTEM,
    tools,
    model: wantModel,
  }),
});
const text = await res.text();
if (!res.ok) throw new Error(res.status + ' ' + text.slice(0, 600));
const after = JSON.parse(text);
console.log('now      v' + after.version + '  ' + (after.model || {}).id
  + '  effort ' + (((after.model || {}).effort || {}).type || '?'));
console.log('\nSessions started from here on pick this up. Sessions already');
console.log('running stay pinned to the version they started on.');
