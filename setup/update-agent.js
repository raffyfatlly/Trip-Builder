// Update an existing agent's prompt or tools. Each update creates a new
// version; sessions already running keep the version they pinned, and new
// sessions get the latest.
//
// Use this rather than create-agent.js, which would leave an orphan behind.
//
//   node --env-file=.env setup/update-agent.js chat
//   node --env-file=.env setup/update-agent.js builder
//   node --env-file=.env setup/update-agent.js both

import { SYSTEM } from '../lib/prompt.js';
import { BUILDER_SYSTEM } from '../lib/builderPrompt.js';
import { TOOLS } from '../lib/schema.js';
import { BUILD_TOOL } from '../lib/brief.js';
import { CHAT_AGENT_ID, BUILDER_AGENT_ID } from '../lib/config.js';

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) throw new Error('ANTHROPIC_API_KEY not set');

const MODEL = 'claude-sonnet-5';
const which = process.argv[2] || 'both';

const HEADERS = {
  'x-api-key': KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'managed-agents-2026-04-01',
  'content-type': 'application/json',
};

// The update verb for an agent is POST, not PATCH or PUT (both return 405).
async function update(id, body) {
  const res = await fetch('https://api.anthropic.com/v1/agents/' + id, {
    method: 'POST', headers: HEADERS, body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(id + ' -> ' + res.status + ' ' + text);
  return JSON.parse(text);
}

if (which === 'chat' || which === 'both') {
  const a = await update(CHAT_AGENT_ID, {
    model: MODEL, system: SYSTEM, tools: [BUILD_TOOL],
  });
  console.log('chat agent   v' + a.version);
}

if (which === 'builder' || which === 'both') {
  const a = await update(BUILDER_AGENT_ID, {
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
      ...TOOLS,
    ],
  });
  console.log('builder      v' + a.version);
}
