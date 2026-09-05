// What a trip costs, and what it is sold for.
//
// raffy, 2026-09-05: "lets bake that into the user. for now I want to give like
// each user (registered email) like a default amount of credit they can use to
// make one trip. a bit more. then we allocate the credit meaning if they move
// beyond they can't use chat or rebuild anymore except just edit their iteniry
// manually. give the paywall... really plan the cost so that like i said im
// safe and have some profit. 3-5 x minimum."
//
// The plan for this was written on 2026-09-01 in the vault
// (notes/trip-builder-credit-pricing-model.md) with a warning attached to it:
// "the single biggest input to every price below is a number nobody has
// observed yet. Measure it before charging anyone." That measurement now
// exists, and it moved two things:
//
//   - A build costs LESS than the plan assumed (RM2.51-RM3.12, not RM6.50).
//   - A conversation costs FAR more (RM8.36 for one trip's chat, against an
//     assumed RM0.12 a turn). Cache reads and web searches, mostly.
//   - Google Places is not "effectively free at any plausible volume". It was
//     40% of a trip.
//
// So the ledger below does not price per action from a table. Tables were what
// got the last estimate wrong, and they go stale the moment a model changes.
// It charges the REAL metered cost of the session, marked up. Everything in
// this app is already metered per session and per person — lib/meter.js for
// services, the provider's own figure for models — and lib/journal.js already
// totals it. Credits are that total, converted.

import { setting, snapshot } from './settings.js';
import { journalSettle } from './journal.js';
import { readLedger, writeLedger, firestoreConfigured } from './firestore.js';

// Local development shares Firestore with production. Without this, running the
// app on a laptop creates ledger rows for made-up sessions and bills real
// accounts for test traffic — which it did, once, within an hour of this file
// existing. Same gate lib/journal.js uses, and for the same reason.
// JOURNAL_LOCAL=1 opts in deliberately; the tests set it.
const deployed = () => !!(process.env.VERCEL || process.env.JOURNAL_LOCAL);

// 1 credit = RM0.01 of retail value.
//
// raffy, 2026-09-01: "make credit in hundres and thousand so it seems like
// more." A RM50 pack is 5,000 credits, which does that without inventing an
// exchange rate that stops meaning anything the first time somebody checks.
export const PER_MYR = 100;

const num = (name, key, dflt) => {
  const v = Number(setting(name, key, ''));
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

// Every one of these is a setting first, so the beta can be retuned from a
// script against Firestore without a deploy. See lib/settings.js.
export const markup = () => num('CREDIT_MARKUP', 'creditMarkup', 5);
export const usdMyr = () => num('USD_MYR', 'usdMyr', 4.4);

// What a registered email starts with.
//
// "one trip. a bit more." The measured spread across eight real beta sessions
// was $1.84 cheapest, $3.55 median, $9.30 at p90. 10,000 credits is RM100 of
// retail, which at 5x is RM20 of real cost — the median trip plus about 30%.
//
// The number that matters for his "im safe" is not the retail figure, it is
// that one signup can cost at most RM20 even if it is spent to the last
// credit. A p90 research marathon runs out partway, which is the paywall
// working rather than failing.
export const grant = () => num('CREDIT_GRANT', 'creditGrant', 10000);

// Nobody signed in has no account to bill, so a session gets its own small
// allowance instead. Without this the app is uncapped for anyone who never
// registers, which is the opposite of what he asked for.
//
// Deliberately short of a build: it buys the whole conversation — the research,
// the options, the recommendation — and stops at the moment they want the
// thing. That is the cut line the pricing note argues for, and signing in is
// what crosses it.
export const anonGrant = () => num('CREDIT_ANON', 'creditAnon', 3500);

/**
 * Real cost in USD -> credits charged.
 *
 * Rounded up, always. A fractional credit that rounds down is a rounding error
 * in the customer's favour on every single request, and there are a lot of
 * requests.
 */
export const creditsFor = (usd) =>
  Math.ceil(Math.max(0, Number(usd) || 0) * usdMyr() * PER_MYR * markup());

/** Credits -> what they are worth to him, and what they cost to serve. */
export const retailMyr = (credits) => (Number(credits) || 0) / PER_MYR;
export const costMyr = (credits) => retailMyr(credits) / markup();

const KEY = (who) => 'u:' + String(who || '').toLowerCase();
const ANON = (session) => 's:' + String(session || '');

const blank = (id, allowance) => ({ id, granted: allowance, used: 0, since: new Date().toISOString() });

/**
 * The ledger for whoever is asking. A registered email gets its own; anyone
 * else gets one tied to the browser session, which is the most that can be
 * enforced without an identity.
 */
export async function ledgerFor(who, session) {
  if (!firestoreConfigured()) return null;
  const id = who ? KEY(who) : ANON(session);
  if (!who && !session) return null;
  const allowance = who ? grant() : anonGrant();
  const got = await readLedger(id);
  if (!deployed()) {
    // Read-only off the deployment: an existing balance still shows, so the
    // paywall can be worked on against real data, but nothing is written.
    return got || blank(id, allowance);
  }
  if (got) {
    // A grant raised in settings reaches people who already have a ledger.
    // Lowered, it does not claw back what somebody was already given — taking
    // credits off a person mid-trip is not a thing this should ever do.
    if (allowance > (got.granted || 0)) return writeLedger({ ...got, granted: allowance });
    return got;
  }
  return writeLedger(blank(id, allowance));
}

export const leftOf = (l) => Math.max(0, (l ? l.granted || 0 : 0) - (l ? l.used || 0 : 0));

/**
 * Can this person start something that spends money?
 *
 * Checked at the START of a turn, never in the middle of one: a turn that has
 * already called a tool has already been paid for, and killing it halfway
 * leaves a half-built trip and charges for it anyway.
 */
export async function allowed(who, session) {
  if (!firestoreConfigured()) return { ok: true, left: null, unmetered: true };
  const l = await ledgerFor(who, session);
  if (!l) return { ok: true, left: null, unmetered: true };
  const left = leftOf(l);
  return {
    ok: left > 0,
    left,
    granted: l.granted || 0,
    used: l.used || 0,
    who: !!who,
  };
}

/**
 * Charge whatever this session has spent since it was last charged.
 *
 * The session journal is the single source of truth for what was spent, and it
 * records what has already been billed, so this is safe to call after every
 * request — including the many that spend nothing. Two writers double-counting
 * the builder is a bug this app has already had once; deriving the charge from
 * one total rather than accumulating it separately is how it does not happen
 * again.
 */
export async function settle(session) {
  if (!firestoreConfigured() || !session || !deployed()) return null;
  try {
    const d = await journalSettle(session, creditsFor);
    if (!d || !d.credits) return null;
    // An anonymous session that signs in mid-trip starts billing the account
    // from that point. What it spent while anonymous stays on the session
    // ledger. Trying to move it would mean holding a mapping nobody reads.
    const id = d.who ? KEY(d.who) : ANON(session);
    const l = (await readLedger(id)) || blank(id, d.who ? grant() : anonGrant());
    await writeLedger({ ...l, used: (l.used || 0) + d.credits });
    return d;
  } catch (err) {
    // Never a reason to fail a request. An uncharged turn costs him a few
    // cents; a 500 on a turn that worked costs him the customer.
    console.error('credits:', err && err.message);
    return null;
  }
}

/** For the admin view and the tests: how the numbers were arrived at. */
export const explain = () => ({
  markup: markup(),
  usdMyr: usdMyr(),
  perMyr: PER_MYR,
  grant: grant(),
  anonGrant: anonGrant(),
  grantWorthMyr: retailMyr(grant()),
  grantCostsMyr: costMyr(grant()),
  configured: Object.keys(snapshot()).length > 0,
});
