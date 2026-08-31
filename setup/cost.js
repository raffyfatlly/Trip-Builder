// What does one build actually cost?
//
// Managed Agents emits a `session.usage` event after every model request.
// Nothing reads them yet — this is the seed of the admin/cost view, and the
// numbers it prints are what any pricing decision has to be built on.
//
//   node --env-file=.env setup/cost.js [sessionId]
//   node --env-file=.env setup/cost.js            # lists recent sessions

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) throw new Error('ANTHROPIC_API_KEY not set');

const H = {
  'x-api-key': KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'managed-agents-2026-04-01',
};

// claude-sonnet-5, USD per million tokens.
const IN_PER_M = 2.0;
const OUT_PER_M = 10.0;
const CACHE_READ_PER_M = 0.20;    // 10% of input
const CACHE_WRITE_PER_M = 2.50;   // 1.25x input

async function get(path) {
  const r = await fetch('https://api.anthropic.com' + path, { headers: H });
  if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + (await r.text()));
  return r.json();
}

const id = process.argv[2];

if (!id) {
  const d = await get('/v1/sessions?limit=20');
  console.log('recent sessions:\n');
  for (const s of d.data || []) {
    console.log('  ' + s.id + '  ' + (s.created_at || '').slice(0, 19) + '  ' + (s.status || ''));
  }
  console.log('\nrun again with a session id for its cost breakdown');
  process.exit(0);
}

const d = await get(`/v1/sessions/${id}/events`);
const events = d.data || [];

let inTok = 0, outTok = 0, cacheRead = 0, cacheWrite = 0, requests = 0;
let searches = 0, toolCalls = 0;

for (const e of events) {
  if (e.type === 'session.usage' || e.usage) {
    const u = e.usage || e;
    if (u.input_tokens || u.output_tokens) {
      requests++;
      inTok += u.input_tokens || 0;
      outTok += u.output_tokens || 0;
      cacheRead += u.cache_read_input_tokens || 0;
      cacheWrite += u.cache_creation_input_tokens || 0;
    }
  }
  if (e.type === 'agent.custom_tool_use') toolCalls++;
  if (e.type === 'agent.tool_use' && /search|fetch/i.test(e.name || '')) searches++;
}

const cost = (inTok * IN_PER_M + outTok * OUT_PER_M
  + cacheRead * CACHE_READ_PER_M + cacheWrite * CACHE_WRITE_PER_M) / 1e6;

console.log('session        ' + id);
console.log('events         ' + events.length);
console.log('model requests ' + requests);
console.log('tool calls     ' + toolCalls + '   (each one is a separate model request)');
console.log('web searches   ' + searches);
console.log('');
console.log('input tokens   ' + inTok.toLocaleString());
console.log('  cache read   ' + cacheRead.toLocaleString());
console.log('  cache write  ' + cacheWrite.toLocaleString());
console.log('output tokens  ' + outTok.toLocaleString());
console.log('');
console.log('model cost     $' + cost.toFixed(4) + '   (excludes web search charges)');
console.log('               RM' + (cost * 4.4).toFixed(2) + ' approx');
