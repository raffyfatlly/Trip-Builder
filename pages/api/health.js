import { storeConfigured } from '../../lib/db.js';
import { orBuilderReady, MODEL } from '../../lib/orBuilder.js';
import { placesKey } from '../../lib/photos.js';
import { checkSources } from '../../lib/facts.js';
import { storageConfigured, bucket, putDoc, getDoc, dropDoc, newDocId } from '../../lib/storage.js';
import { agentDrift } from '../../lib/managedAgents.js';
import { CHAT_AGENT_ID } from '../../lib/config.js';
import { SYSTEM } from '../../lib/prompt.js';
import { READ_TOOL, EDIT_TOOL } from '../../lib/editTools.js';
import { BUILD_TOOL } from '../../lib/brief.js';
import { PRICE_TOOL } from '../../lib/prices.js';

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

// A real round trip: write a small object, read it back, delete it. Anything
// less answers "is it configured", which is not the question — the question is
// whether the service account can actually write to the bucket.
async function checkDocStore() {
  if (!storageConfigured()) return 'no bucket configured';
  try {
    const id = newDocId();
    await putDoc('health', { id, name: 'health', type: 'text/plain', bytes: Buffer.from('ok') });
    const back = await getDoc('health', id);
    await dropDoc('health', id);
    return back && back.body.toString() === 'ok' ? 'ok (' + bucket() + ')' : 'wrote but could not read back';
  } catch (err) {
    return String(err.message || err).slice(0, 160);
  }
}

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
    // Whether a confirmation somebody sends in can be handed back to them as
    // a link. Needs a bucket and the service account holding Storage Object
    // Admin on it; `?sources=1` proves it rather than assuming it.
    // The bucket it would use. Whether it EXISTS is a different question,
    // and only ?sources=1 answers it — a name resolving is not a bucket.
    docsBucket: storageConfigured() ? bucket() : false,
    ...(sources ? {
      sources,
      docStore: await checkDocStore(),
      // Whether the agent people are actually talking to is running the prompt
      // and the tools in this repo. It is not automatic and no deploy does it.
      chatAgent: await agentDrift(CHAT_AGENT_ID, SYSTEM, [READ_TOOL, EDIT_TOOL, BUILD_TOOL, PRICE_TOOL]),
    } : {}),
  });
}
