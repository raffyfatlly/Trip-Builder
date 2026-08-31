// Agents and environment are persisted objects created once by
// setup/create-agent.js. Never create them in the request path.
export const CHAT_AGENT_ID = 'agent_01MVw27b9bARi9zkBANhGLWj';
export const BUILDER_AGENT_ID = 'agent_011zrMmusHh1KLJQ3MkjhcHm';
export const ENV_ID = 'env_019Bue5QoTjYpm331MyukPrF';

// Cheap insurance: there is no link gating, and the API key bills a real card.
export const MAX_TURNS_PER_SESSION = 40;

// The key comes from the environment only.
//
// It was going to be embedded here with an env fallback, so the deployment
// would work the instant it went up. GitHub push protection rejected that
// commit ("Anthropic API Key", lib/config.js:18) and it was right to: this key
// is UNCAPPED and bills a real card, and a secret in git history outlives any
// later cleanup. Set ANTHROPIC_API_KEY in the Vercel project instead.
//
// Server-side only. Never import this into anything that renders client-side.
export function apiKey() {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) throw new Error('ANTHROPIC_API_KEY is not set on this deployment.');
  return k;
}
