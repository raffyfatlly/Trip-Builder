import { storeConfigured } from '../../lib/db.js';
import { orBuilderReady, MODEL, builderProbe, modelSearch } from '../../lib/orBuilder.js';
import { setting } from '../../lib/settings.js';
import { research, WORKER } from '../../lib/research.js';

// The key can arrive from the environment or from the config document, and
// health saying "no key" while the builder happily uses one is the kind of
// wrong answer that costs an hour.
const settingOR = () => setting('OPENROUTER_API_KEY', 'openrouterKey');
import { placesKey } from '../../lib/photos.js';
import { checkSources } from '../../lib/facts.js';
import { storageConfigured, bucket, putDoc, getDoc, dropDoc, newDocId, listBuckets, resolveBucket, createBucket } from '../../lib/storage.js';
import { agentDrift } from '../../lib/managedAgents.js';
import { CHAT_AGENT_ID, BUILDER_AGENT_ID } from '../../lib/config.js';
import { BUILDER_SYSTEM } from '../../lib/builderPrompt.js';
import { TOOLS } from '../../lib/schema.js';
import { SYSTEM } from '../../lib/prompt.js';
import { READ_TOOL, EDIT_TOOL } from '../../lib/editTools.js';
import { BUILD_TOOL } from '../../lib/brief.js';
import { PRICE_TOOL, priceProbe } from '../../lib/prices.js';
import { scrape, firecrawlReady } from '../../lib/firecrawl.js';
import { syncAgents } from '../../lib/agentSync.js';
import { loadConfig } from '../../lib/settings.js';

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
    // Settle on a bucket that exists before writing to one that might not.
    // This check used to report "The specified bucket does not exist" because
    // the name was a guess at Firebase's 2024 rename; now it asks.
    const named = await resolveBucket();
    if (!named) {
      const all = await listBuckets();
      return all.length
        ? 'no Firebase default bucket; project has: ' + all.join(', ')
        : 'the project has no storage bucket at all — create one in the Firebase console';
    }
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
  // `?builder=1` asks OpenRouter whether the configured model is real and what
  // it charges. Reads the catalogue only, so it sends no completion and costs
  // nothing; opt-in anyway, because it is a real outbound request.
  const builderModel = req.query && req.query.builder ? await builderProbe() : undefined;
  // `?models=deepseek,qwen` searches OpenRouter's catalogue from the deployment
  // that can reach it, so a model is chosen against real prices rather than
  // remembered ones. Reads the catalogue only; costs nothing.
  const models = req.query && req.query.models ? await modelSearch(req.query.models) : undefined;
  // `?research=<question>` actually runs one research call. Unlike every other
  // probe here this one SPENDS money — a few tenths of a cent — because the one
  // thing that could not be checked from the catalogue is whether OpenRouter's
  // web search works on this account at all. Opt-in, and it reports which of
  // the two shapes answered.
  // `?prices=<city>` runs one REAL hotel lookup and shows each stage of it.
  // The hotel provider cannot be reached from the sandbox, so this endpoint is
  // the only honest way to know whether a rate lookup works.
  const prices = req.query && req.query.prices
    ? await priceProbe(String(req.query.prices), req.query.hotel && String(req.query.hotel))
    : undefined;

  // `?firecrawl=<url>` fetches one real page. Firecrawl is unreachable from the
  // sandbox, so nothing in the repo could tell us whether the key works — and
  // with every hotel API endpoint now returning 404, reading a page is the only
  // route left to a real rate. Costs one Firecrawl credit, so it is opt-in.
  let firecrawl;
  if (req.query && req.query.firecrawl) {
    // loadConfig() first: the key lives in the config document, not the
    // environment, and setting() reads a snapshot that is empty until someone
    // has awaited the load. Without this the probe reports "not configured"
    // for a key that is sitting right there.
    await loadConfig();
    const t0 = Date.now();
    const text = await scrape(String(req.query.firecrawl));
    firecrawl = {
      configured: firecrawlReady(),
      seconds: +((Date.now() - t0) / 1000).toFixed(1),
      chars: text.length,
      head: text.slice(0, 400),
    };
  }

  // `?syncagent=1` pushes this repo's prompt and tools to both persisted agents
  // now, rather than waiting for the next session to do it. The deployment does
  // this on its own before every chat session; this is here so a deploy can be
  // CHECKED without starting a conversation, which is how the stale-agent
  // problem stayed invisible for so long. Idempotent — a matching agent is read
  // and left alone.
  const agentSync = req.query && req.query.syncagent
    ? await syncAgents({ force: true }) : undefined;

  // `?makebucket=1` creates the project's default storage bucket, once. The
  // lookup established the project has none at all — Firebase Storage was never
  // switched on — so booking confirmations had nowhere to go. It can only ever
  // create the one Firebase default name and refuses if any bucket exists.
  const madeBucket = req.query && req.query.makebucket ? await createBucket() : undefined;

  let desk;
  if (req.query && req.query.research) {
    const t0 = Date.now();
    const r = await research([String(req.query.research)],
      req.query.worker ? { model: String(req.query.worker) } : {});
    desk = {
      worker: r.model || WORKER(), webSearchVia: r.shape || 'neither',
      seconds: +((Date.now() - t0) / 1000).toFixed(1),
      usd: r.usage ? +Number(r.usage.usd).toFixed(5) : null,
      tokens: r.usage ? { in: r.usage.in, out: r.usage.out } : null,
      answer: r.text,
    };
  }
  res.status(200).json({
    accounts: storeConfigured(),
    builder: (await orBuilderReady()) ? MODEL() : 'anthropic (managed agents)',
    builderModel,
    models,
    prices,
    agentSync,
    madeBucket,
    firecrawl,
    desk,
    openrouterKey: !!settingOR(),
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
      // The builder is a second persisted agent with the same trap. Its
      // itinerary schema lives server-side too, so a new field on a trip —
      // arriveBy, say — does nothing until it is pushed.
      builderAgent: await agentDrift(BUILDER_AGENT_ID, BUILDER_SYSTEM, TOOLS),
    } : {}),
  });
}
