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

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) throw new Error('ANTHROPIC_API_KEY not set');

const H = {
  'x-api-key': KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'managed-agents-2026-04-01',
  'content-type': 'application/json',
};

const tools = [
  // Every container tool off, and no web search: the chat agent researches
  // through RESEARCH_TOOL now, on our own server. See lib/research.js for why.
  { type: 'agent_toolset_20260401', default_config: { enabled: false } },
  RESEARCH_TOOL,
  BUILD_TOOL, READ_TOOL, EDIT_TOOL, PRESENT_TOOL, PROPOSE_TOOL, NOTE_TOOL,
  REMEMBER_TOOL, FORGET_TOOL,
  ...FACT_TOOLS,
  PRICE_TOOL,
];

const before = await (await fetch('https://api.anthropic.com/v1/agents/' + CHAT_AGENT_ID, { headers: H })).json();
console.log('now      v' + before.version + '  ' + (before.model || {}).id
  + '  ' + (before.tools || []).length + ' tool entries');

const names = tools.map((t) => t.name || t.type);
console.log('sending  ' + names.length + ' tool entries: ' + names.join(', '));

if (process.argv.includes('--dry')) {
  console.log('\n(dry run, nothing sent)');
  process.exit(0);
}

const res = await fetch('https://api.anthropic.com/v1/agents/' + CHAT_AGENT_ID, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ system: SYSTEM, tools }),
});
const text = await res.text();
if (!res.ok) throw new Error(res.status + ' ' + text.slice(0, 600));
const after = JSON.parse(text);
console.log('now      v' + after.version + '  ' + (after.model || {}).id);
console.log('\nSessions started from here on pick this up. Sessions already');
console.log('running stay pinned to the version they started on.');
