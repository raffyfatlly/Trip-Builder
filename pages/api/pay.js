// Start a purchase. Returns a Stripe-hosted checkout URL; takes no card details.
//
// Deliberately thin. Everything that decides what somebody gets — the pack, its
// price, its credits — lives in lib/stripe.js and the config document, never in
// what the browser sends. A client that could name its own credit count is a
// client that will.

import { checkout, packs, packById, packSafe, stripeReady } from '../../lib/stripe.js';
import { myrPerCredit, markup } from '../../lib/credits.js';
import { userFrom } from '../../lib/auth.js';
import { loadConfig } from '../../lib/settings.js';
import { billed } from '../../lib/billed.js';

async function handler(req, res) {
  // The key and the pack list live in the config document, and setting() reads
  // a snapshot that is empty until somebody has awaited the load.
  await loadConfig();

  if (req.method === 'GET') {
    // What is on sale, for the paywall to draw. No secrets in here.
    return res.status(200).json({
      ready: stripeReady(),
      packs: packs().map(({ id, name, myr, credits }) => ({ id, name, myr, credits })),
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST' });

  if (!stripeReady()) return res.status(503).json({ error: 'Payments are not switched on yet.' });

  // WHO IS PAYING COMES FROM THE COOKIE, NEVER THE BODY. The webhook credits
  // whatever account is named on the session, so letting the browser choose it
  // would let anyone top up — or drain — somebody else's balance.
  let who = '';
  try { who = userFrom(req) || ''; } catch (e) { /* not signed in */ }
  if (!who) return res.status(401).json({ error: 'Sign in first, so the credits have somewhere to land.' });

  const pack = packById((req.body || {}).pack);
  if (!pack) return res.status(400).json({ error: 'No such pack.' });

  // THE CEILING, ENFORCED BEFORE THE MONEY MOVES. raffy's rule is that RM28 must
  // never buy more than RM10 of cost. The packs in config could be hand-edited
  // to break that; this refuses the sale rather than discovering it in a bill.
  if (!packSafe(pack, myrPerCredit(), markup())) {
    console.error('pay: pack breaks the cost ceiling', pack, myrPerCredit(), markup());
    return res.status(500).json({ error: 'That pack is misconfigured. Nothing has been charged.' });
  }

  try {
    const origin = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host);
    const session = await checkout({ pack: pack.id, who, origin });
    return res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    console.error('pay failed:', err && err.message);
    return res.status(502).json({ error: 'Could not start the payment. Nothing has been charged.' });
  }
}

export default billed(handler);
