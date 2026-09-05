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

// What one credit is.
//
// raffy, 2026-09-05: "reflect the credit to be alligned with the one we use in
// landing page. maybe thousands seems to much."
//
// The landing page has said this since it went up, and it is the number people
// will have read before they ever see a balance:
//
//     Planning a whole trip                50
//     Redoing it after your plans change   20
//     Looking up hotels, food or a day out  3
//     Changing something yourself         Free
//
// So a trip is fifty credits, and the unit falls out of that against the
// measured median trip (RM15.62 across eight real beta sessions):
// RM15.62 / 50 = RM0.31 of real API cost per credit.
//
// This replaces "1 credit = RM0.01 of retail", which made a trip 7,810 credits.
// He is right that it read as too much — and the deeper problem was that it
// tied the burn rate to the SELLING price, so changing the markup silently
// changed how fast a trip ate somebody's balance. Two different questions,
// which now have two different answers:
//
//     burn rate   what a credit COSTS to serve   RM0.31, fixed
//     markup      what a credit SELLS for        RM0.31 x 5 = RM1.55
//
const num = (name, key, dflt) => {
  const v = Number(setting(name, key, ''));
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

export const myrPerCredit = () => num('CREDIT_COST_MYR', 'creditCostMyr', 0.31);

// Every one of these is a setting first, so the beta can be retuned from a
// script against Firestore without a deploy. See lib/settings.js.
export const markup = () => num('CREDIT_MARKUP', 'creditMarkup', 5);
export const usdMyr = () => num('USD_MYR', 'usdMyr', 4.4);

// What a registered email starts with.
//
// "one trip. a bit more." A trip is 50, so 70 is one trip and a bit — the same
// intent as the 10,000 it replaces, in the numbers the landing page uses.
//
// The figure that matters for his "im safe" is not the retail value. It is that
// one signup can cost at most 70 x RM0.31 = RM21.70 even if spent to the last
// credit. A p90 research marathon needs 136 and runs out partway, which is the
// paywall working rather than failing.
export const grant = () => num('CREDIT_GRANT', 'creditGrant', 70);

// Nobody signed in has no account to bill, so a session gets its own smaller
// allowance instead. Without it the app is uncapped for anyone who never
// registers, which is the opposite of what he asked for.
//
// Deliberately short of a trip: it buys the conversation — the research, the
// options, the recommendation — and stops at the moment they want the thing.
// That is the cut line the pricing note argues for, and signing in crosses it.
export const anonGrant = () => num('CREDIT_ANON', 'creditAnon', 25);

/**
 * Real cost in USD -> credits charged.
 *
 * Rounded up, always. A fractional credit that rounds down is a rounding error
 * in the customer's favour on every single request, and there are a lot of
 * requests.
 */
export const creditsFor = (usd) =>
  Math.ceil(Math.max(0, Number(usd) || 0) * usdMyr() / myrPerCredit());

/** Credits -> what they cost to serve, and what they should sell for. */
export const costMyr = (credits) => (Number(credits) || 0) * myrPerCredit();
export const retailMyr = (credits) => costMyr(credits) * markup();

const KEY = (who) => 'u:' + String(who || '').toLowerCase();
const ANON = (session) => 's:' + String(session || '');

const blank = (id, allowance) => ({ id, granted: allowance, used: 0, plan: 0, build: 0, since: new Date().toISOString() });

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
    // What the ring draws. Two arcs, in the traveller's words rather than the
    // provider's: planning is the conversation and the looking-things-up it
    // did, building is making the app.
    plan: l.plan || 0,
    build: l.build || 0,
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
    await writeLedger({
      ...l,
      used: (l.used || 0) + d.credits,
      plan: (l.plan || 0) + (d.plan || 0),
      build: (l.build || 0) + (d.build || 0),
    });
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
  myrPerCredit: myrPerCredit(),
  creditSellsFor: +(myrPerCredit() * markup()).toFixed(2),
  grant: grant(),
  anonGrant: anonGrant(),
  grantWorthMyr: +retailMyr(grant()).toFixed(2),
  grantCostsMyr: +costMyr(grant()).toFixed(2),
  configured: Object.keys(snapshot()).length > 0,
});
