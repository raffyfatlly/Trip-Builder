import { storeConfigured } from '../../lib/db.js';
import { orBuilderReady, MODEL } from '../../lib/orBuilder.js';
import { placesKey } from '../../lib/photos.js';
import { checkSources } from '../../lib/facts.js';

// What is actually switched on in this deployment.
//
// Booleans only — never a key, never a value. It exists because "did the env
// var land?" was otherwise only answerable by running a real build, and a
// build is the single most expensive thing this app does. Now it is one GET.
//
// `?sources=1` additionally PINGS every outside service the fact tools depend
// on and reports what each one said. That exists because those hosts are
// unreachable from the sandbox this app is written in, so the only honest way
// to know whether the weather, the holidays, the exchange rate and the routing
// actually work is to ask the deployment that can reach them. It costs a few
// real requests, so it is opt-in.

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  const sources = req.query && req.query.sources ? await checkSources() : undefined;
  res.status(200).json({
    accounts: storeConfigured(),
    builder: orBuilderReady() ? MODEL() : 'anthropic (managed agents)',
    openrouterKey: !!process.env.OPENROUTER_API_KEY,
    anthropicKey: !!process.env.ANTHROPIC_API_KEY,
    googlePhotos: !!placesKey(),
    // False means the signing key is the deployment id, so every deploy signs
    // everyone out. That was the "why do I keep typing my email" bug.
    sessionsSurviveDeploys: !!(process.env.AUTH_SECRET || process.env.FIREBASE_SERVICE_ACCOUNT),
    ...(sources ? { sources } : {}),
  });
}
