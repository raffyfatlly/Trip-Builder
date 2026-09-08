// Stripe tells us a payment succeeded; credits land here.
//
// THE RAW BODY IS THE WHOLE POINT. Next parses JSON by default, and a body that
// has been parsed and re-stringified will not match the signature — key order,
// whitespace, number formatting, any of it. So the parser is off and the body is
// read as bytes. Getting this wrong fails closed (every webhook rejected), which
// is the good direction, but it is invisible until nobody's credits arrive.

import { verify, packById } from '../../lib/stripe.js';
import { loadConfig } from '../../lib/settings.js';
import { readLedger, writeLedger, bumpLedger, setLedger, claimOnce, firestoreConfigured } from '../../lib/firestore.js';

export const config = { api: { bodyParser: false } };

const raw = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  await loadConfig();

  let event;
  try {
    event = verify(await raw(req), req.headers['stripe-signature']);
  } catch (err) {
    // 400, not 500: a bad signature is not our fault and Stripe should not
    // retry it. Anything that reaches here is either misconfigured or hostile.
    console.error('stripe webhook rejected:', err && err.message);
    return res.status(400).json({ error: 'bad signature' });
  }

  try {
    // TWO EVENTS GRANT CREDITS, NOT ONE — and the second is the one that matters
    // in Malaysia.
    //
    // A card pays instantly: checkout.session.completed arrives with
    // payment_status 'paid' and we are done. FPX — online banking, which is how
    // a great many Malaysians actually pay — does not. Its session completes
    // with payment_status 'unpaid' while the bank is still thinking, and the
    // money confirms minutes later as checkout.session.async_payment_succeeded.
    //
    // Listening only for `completed` would therefore take FPX money and never
    // grant the credits. The customer pays and gets nothing, and nothing in the
    // logs looks broken.
    const GRANTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
    if (!GRANTS.includes(event.type)) {
      // Everything else is acknowledged and ignored. A 200 stops Stripe
      // retrying an event we were never going to act on.
      //
      // A failed async payment is worth a line in the log even though there is
      // nothing to undo: it is the only trace that somebody tried to pay and
      // their bank said no.
      if (event.type === 'checkout.session.async_payment_failed') {
        console.log('stripe: async payment failed for', (event.data.object || {}).id);
      }
      return res.status(200).json({ ok: true, ignored: event.type });
    }

    const s = event.data.object;
    // `paid` rather than `complete`. On the card path this is already true; on
    // the FPX path it is false on `completed` and true on the async event, so
    // this single guard is what makes listening to both safe — the first
    // delivery defers, the second grants, and neither double-counts.
    if (s.payment_status !== 'paid') {
      return res.status(200).json({ ok: true, pending: s.payment_status });
    }

    const who = String((s.metadata || {}).who || s.client_reference_id || '').toLowerCase();
    const pack = packById((s.metadata || {}).pack);
    const credits = Number((s.metadata || {}).credits) || (pack ? pack.credits : 0);
    if (!who || !credits) {
      // Acknowledge — retrying will not conjure the metadata — but shout, because
      // this is money that arrived with nowhere to go.
      console.error('stripe: paid session with no account or credits', s.id, who, credits);
      return res.status(200).json({ ok: true, orphaned: s.id });
    }
    if (!firestoreConfigured()) {
      console.error('stripe: paid but no ledger to credit', s.id);
      return res.status(500).json({ error: 'no ledger' });
    }

    // EXACTLY ONCE. Stripe retries until it gets a 200 and can deliver a
    // successful event twice regardless; without this, one RM28 payment grants
    // 200 credits. The write itself is the lock — see claimOnce.
    const first = await claimOnce('payments', event.id, {
      session: s.id, who, credits, myr: (s.amount_total || 0) / 100, type: event.type,
    });
    if (!first) return res.status(200).json({ ok: true, duplicate: event.id });

    const id = 'u:' + who;
    // ADDED, not recomputed. This read the ledger, added the pack to `granted`
    // and wrote the whole document back — so a charge that landed between the
    // read and the write was erased by somebody's own purchase. The claim above
    // makes the grant exactly-once; the increment makes it safe to land
    // alongside anything else happening to that ledger.
    if (!(await readLedger(id))) {
      await writeLedger({ id, granted: 0, used: 0, plan: 0, build: 0, since: new Date().toISOString() });
    }
    await bumpLedger(id, { granted: credits });
    // `paid` is what unlocks building, and it is set here — the one place that
    // knows money actually arrived.
    await setLedger(id, { paid: true });
    console.log('stripe: granted', credits, 'credits to', who, 'for', s.id);
    return res.status(200).json({ ok: true, granted: credits });
  } catch (err) {
    // 500 so Stripe RETRIES. The claim above makes that safe: a retry that gets
    // past it has genuinely not been applied yet.
    console.error('stripe webhook failed:', err && err.message);
    return res.status(500).json({ error: 'could not apply' });
  }
}
