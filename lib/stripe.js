// Taking money, and turning it into credits.
//
// raffy, 2026-09-07, setting the rule that governs every number here:
//
//   "im targeting about RM 28 for first payment. thats a nice cost to plan a
//    big trip. just that make sure for every rm 28 they spend. i will not incur
//    more than RM 10 cost. u got me?"
//
// That is a CEILING, not a margin target, and it is a much better rule than the
// 3-5x it replaced: a margin can be broken by one expensive turn, a ceiling
// cannot. It maps onto the existing engine without changing its shape —
// lib/credits.js already separates what a credit costs to serve
// (myrPerCredit) from what it sells for (markup). RM10 of cost across 100
// credits is RM0.10 each; RM28 for those 100 is 2.8x. Both are settings.
//
// No SDK. Stripe's REST API is form-encoded and the webhook signature is an
// HMAC — both are a few lines, and this codebase already does every other
// provider over fetchWith. A dependency here would be the only one in the file.

import crypto from 'crypto';
import { fetchWith } from './net.js';
import { setting } from './settings.js';

const API = 'https://api.stripe.com/v1';
const T = 15000;

// Never in the repo. This one is public — see the note in lib/firecrawl.js for
// the same decision about the Firecrawl key, and the same reason.
export const secret = () => setting('STRIPE_SECRET', 'stripeSecret');
export const publishable = () => setting('STRIPE_PUBLISHABLE', 'stripePublishable');
export const webhookSecret = () => setting('STRIPE_WEBHOOK_SECRET', 'stripeWebhookSecret');
export const stripeReady = () => !!secret();
export const liveMode = () => /^sk_live_/.test(secret() || '');

/**
 * What is for sale.
 *
 * Credits are what the app SPENDS — one credit is ten sen of real cost — so a
 * pack's credit count is the ceiling on what that customer can cost us. RM28
 * buys 100 credits, which is RM10 of cost. Every pack holds the same 2.8x, so
 * there is no bulk discount quietly eating the margin.
 *
 * A trip runs 27 credits (light) to 48 (heavy), measured. So RM28 is one big
 * trip with room to change it, and usually two. Say one — under-promising is
 * the whole point of a ceiling.
 *
 * In config so prices move without a deploy, which is how they will move.
 */
const DEFAULT_PACKS = [
  { id: 'topup', name: 'Top up', myr: 10, credits: 35 },
  { id: 'starter', name: 'Plan a trip', myr: 28, credits: 100 },
  { id: 'plus', name: 'Plan a few', myr: 68, credits: 242 },
];

export function packs() {
  const raw = setting('STRIPE_PACKS', 'stripePacks', '');
  if (!raw) return DEFAULT_PACKS;
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(p) && p.length ? p : DEFAULT_PACKS;
  } catch (e) { return DEFAULT_PACKS; }
}

export const packById = (id) => packs().find((p) => p.id === String(id || '')) || null;

/**
 * THE CEILING, CHECKED IN CODE.
 *
 * A pack whose credits are worth more cost than its price covers is a pack that
 * loses money on a heavy user, silently, one sale at a time. This is the rule
 * as an assertion rather than as a comment — so a hand-edited config that
 * breaks it is refused at checkout instead of discovered in a bill.
 */
export function packSafe(pack, myrPerCredit, minMultiple) {
  const worstCost = (Number(pack.credits) || 0) * myrPerCredit;
  return worstCost > 0 && (Number(pack.myr) || 0) / worstCost >= minMultiple;
}

const form = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => {
  const key = prefix ? prefix + '[' + k + ']' : k;
  if (v == null) return [];
  if (typeof v === 'object') return form(v, key);
  return [encodeURIComponent(key) + '=' + encodeURIComponent(String(v))];
});

async function post(path, body, idempotencyKey) {
  const res = await fetchWith(API + path, T, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + secret(),
      'content-type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: form(body).join('&'),
  });
  const text = await res.text();
  if (!res.ok) {
    let why = text.slice(0, 300);
    try { why = (JSON.parse(text).error || {}).message || why; } catch (e) { /* raw */ }
    throw new Error('stripe ' + res.status + ': ' + why);
  }
  return JSON.parse(text);
}

/**
 * A hosted checkout page for one pack.
 *
 * Hosted rather than an embedded card form on purpose: Stripe's page handles
 * 3-D Secure, FPX and the local wallets a Malaysian buyer expects, and no card
 * number ever touches this app — which is the difference between needing SAQ-A
 * and needing an audit.
 *
 * `who` rides in metadata AND client_reference_id because the webhook needs to
 * know whose ledger to credit, and a session with no email attached is money
 * that arrives with nowhere to go.
 */
export async function checkout({ pack, who, origin }) {
  if (!stripeReady()) throw new Error('stripe is not configured');
  const p = packById(pack);
  if (!p) throw new Error('no such pack: ' + pack);
  const email = String(who || '').trim().toLowerCase();
  if (!email) throw new Error('sign in first — a payment needs an account to land in');

  const base = String(origin || '').replace(/\/$/, '');
  return post('/checkout/sessions', {
    mode: 'payment',
    // MYR is a two-decimal currency, so the smallest unit is sen.
    line_items: {
      0: {
        quantity: 1,
        price_data: {
          currency: 'myr',
          unit_amount: Math.round(Number(p.myr) * 100),
          product_data: {
            name: 'Trip Builder — ' + p.credits + ' credits',
            description: p.name,
          },
        },
      },
    },
    customer_email: email,
    client_reference_id: email,
    metadata: { who: email, pack: p.id, credits: p.credits },
    // Carried onto the PaymentIntent too, so a refund or a dispute can be
    // traced back to the account without joining two objects.
    payment_intent_data: { metadata: { who: email, pack: p.id, credits: p.credits } },
    success_url: base + '/?paid=' + p.id,
    cancel_url: base + '/?paid=cancelled',
  });
}

/**
 * Verify a webhook actually came from Stripe.
 *
 * WITHOUT THIS THE ENDPOINT IS A FREE CREDIT DISPENSER. Anyone who finds the URL
 * can POST a checkout.session.completed and grant themselves whatever they like.
 * The signature is the only thing standing between the two.
 *
 * Three things this checks, all of which matter:
 *   - the HMAC matches, computed over `timestamp.rawBody` with the endpoint
 *     secret. The RAW body — a parsed-and-restringified body will not match, and
 *     that is why the route disables Next's body parser.
 *   - the comparison is timing-safe, so the signature cannot be guessed a byte
 *     at a time.
 *   - the timestamp is recent, so a captured request cannot be replayed later.
 */
export function verify(raw, header, tolerance = 300) {
  const key = webhookSecret();
  if (!key) throw new Error('no webhook secret configured');
  const parts = Object.fromEntries(String(header || '').split(',')
    .map((kv) => kv.split('=', 2)).filter((x) => x.length === 2));
  const t = Number(parts.t);
  const sent = parts.v1;
  if (!t || !sent) throw new Error('malformed stripe signature');

  const expected = crypto.createHmac('sha256', key)
    .update(t + '.' + (Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)))
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(sent), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('signature does not match');
  }
  if (Math.abs(Date.now() / 1000 - t) > tolerance) throw new Error('signature too old');
  return JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
}

/** For the health probe: prove the key works without moving any money. */
export async function stripeProbe() {
  if (!stripeReady()) return { configured: false };
  try {
    const res = await fetchWith(API + '/balance', T, {
      headers: { authorization: 'Bearer ' + secret() },
    });
    const j = await res.json();
    return {
      configured: true,
      live: liveMode(),
      ok: res.ok,
      account: res.ok ? { livemode: j.livemode } : (j.error || {}).message,
      webhookSecret: !!webhookSecret(),
      packs: packs(),
    };
  } catch (err) {
    return { configured: true, ok: false, error: String((err && err.message) || err).slice(0, 200) };
  }
}
