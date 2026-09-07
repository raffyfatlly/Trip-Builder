// Stripe tells us a payment succeeded; credits land here.
//
// THE RAW BODY IS THE WHOLE POINT. Next parses JSON by default, and a body that
// has been parsed and re-stringified will not match the signature — key order,
// whitespace, number formatting, any of it. So the parser is off and the body is
// read as bytes. Getting this wrong fails closed (every webhook rejected), which
// is the good direction, but it is invisible until nobody's credits arrive.

import { verify, packById } from '../../lib/stripe.js';
import { loadConfig } from '../../lib/settings.js';
import { readLedger, writeLedger, claimOnce, firestoreConfigured } from '../../lib/firestore.js';

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
    if (event.type !== 'checkout.session.completed') {
      // Everything else is acknowledged and ignored. A 200 stops Stripe
      // retrying an event we were never going to act on.
      return res.status(200).json({ ok: true, ignored: event.type });
    }

    const s = event.data.object;
    // `paid` rather than `complete`: a session can complete with an async
    // payment (FPX, bank debit) still pending, and crediting on that is
    // crediting money that has not arrived.
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
    const l = (await readLedger(id)) || { id, granted: 0, used: 0, plan: 0, build: 0, since: new Date().toISOString() };
    await writeLedger({ ...l, granted: (l.granted || 0) + credits });
    console.log('stripe: granted', credits, 'credits to', who, 'for', s.id);
    return res.status(200).json({ ok: true, granted: credits });
  } catch (err) {
    // 500 so Stripe RETRIES. The claim above makes that safe: a retry that gets
    // past it has genuinely not been applied yet.
    console.error('stripe webhook failed:', err && err.message);
    return res.status(500).json({ error: 'could not apply' });
  }
}
