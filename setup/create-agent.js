// One-time setup: the environment and the two agents.
//
//   CHAT    talks to the traveller, asks the good questions, writes the brief.
//           No web search — it should be quick and conversational.
//   BUILDER never speaks to anyone. Takes one brief, researches hard, and
//           produces the itinerary through the custom tools.
//
// Splitting them is what keeps the chat responsive: a single agent doing
// intake and research in the same turn took ~140s to reply.
//
// Agents are persisted, versioned objects. Re-running this creates NEW agents;
// to change behaviour use update-agent.js so the version bumps instead.
//
//   node --env-file=.env setup/create-agent.js

import { SYSTEM } from '../lib/prompt.js';
import { BUILDER_SYSTEM } from '../lib/builderPrompt.js';
import { TOOLS } from '../lib/schema.js';
import { BUILD_TOOL } from '../lib/brief.js';
import { READ_TOOL, EDIT_TOOL } from '../lib/editTools.js';
import { PRESENT_TOOL, PROPOSE_TOOL } from '../lib/blocks.js';
import { FIND_TOOL } from '../lib/photos.js';
import { NOTE_TOOL } from '../lib/plan.js';
import { REMEMBER_TOOL, FORGET_TOOL } from '../lib/memory.js';
import { FACT_TOOLS } from '../lib/facts.js';
import { PRICE_TOOL } from '../lib/prices.js';

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) throw new Error('ANTHROPIC_API_KEY not set');

const MODEL = 'claude-sonnet-5';

const HEADERS = {
  'x-api-key': KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'managed-agents-2026-04-01',
  'content-type': 'application/json',
};

async function post(path, body) {
  const res = await fetch('https://api.anthropic.com' + path, {
    method: 'POST', headers: HEADERS, body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(path + ' -> ' + res.status + ' ' + text);
  return JSON.parse(text);
}

const env = await post('/v1/environments', {
  name: 'Itinerary builder',
  config: { type: 'cloud' },
});
console.log('environment  ' + env.id);

// Chat agent: no web search. It is not the one doing research, and keeping it
// off is most of why the conversation stays fast.
const chat = await post('/v1/agents', {
  name: 'Itinerary chat',
  model: MODEL,
  system: SYSTEM,
  tools: [
    // The chat agent researches now: a travel agent that cannot tell you what
    // a hotel costs is not a travel agent. Bounded by the prompt rather than
    // switched off, because a search turn is still far cheaper than a build.
    {
      type: 'agent_toolset_20260401',
      default_config: { enabled: false },
      configs: [
        { name: 'web_search', enabled: true },
        { name: 'web_fetch', enabled: true },
      ],
    },
    BUILD_TOOL, READ_TOOL, EDIT_TOOL, PRESENT_TOOL, PROPOSE_TOOL, NOTE_TOOL,
    REMEMBER_TOOL, FORGET_TOOL,
    // Hours, real travel times, the weather on their dates, the live rate.
    ...FACT_TOOLS,
    // Real fares and rates on their actual dates, through Travelpayouts.
    PRICE_TOOL,
  ],
});
console.log('chat agent   ' + chat.id + '  v' + chat.version);

// Builder: web search on, container tools off. It produces structured data
// through custom tools and never needs a workspace, so bash/read/write would
// be cost and attack surface for nothing.
const builder = await post('/v1/agents', {
  name: 'Itinerary builder',
  model: MODEL,
  system: BUILDER_SYSTEM,
  tools: [
    {
      type: 'agent_toolset_20260401',
      default_config: { enabled: false },
      configs: [
        { name: 'web_search', enabled: true },
        { name: 'web_fetch', enabled: true },
      ],
    },
    FIND_TOOL,
    ...TOOLS,
  ],
});
console.log('builder      ' + builder.id + '  v' + builder.version);
console.log('model        ' + MODEL);
console.log('');
console.log('lib/config.js:');
console.log('  CHAT_AGENT_ID    = ' + JSON.stringify(chat.id));
console.log('  BUILDER_AGENT_ID = ' + JSON.stringify(builder.id));
console.log('  ENV_ID           = ' + JSON.stringify(env.id));
