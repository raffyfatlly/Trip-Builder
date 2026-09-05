// What each beta tester did, and what it cost.
//
// raffy, 2026-09-04: "create a logging for each user activity... im about to
// open it for beta testing to other people. so if people have any issue, we can
// help track and solve their issue. most importantly i wanna see the cost.
// cause right now i don't place any limitation."
//
// Two jobs in one record, because they answer each other. When somebody says
// "it just sat there", the timeline says whether a build ran and what it
// returned; when the bill arrives, the same rows say which sessions were
// expensive and what they were doing at the time.
//
// Three rules, in order of importance:
//
// 1. **It can never break a request.** Every function here swallows everything.
//    A journal that takes the app down with it is worse than no journal.
// 2. **It never blocks the answer.** Callers are expected to fire and forget.
// 3. **It stores what helps, not everything.** A message preview rather than
//    the message; counts rather than payloads. The full transcript already
//    lives in the session log if a specific complaint needs it.
//
// One Firestore document per session, read-modify-write. That is the wrong
// shape for a thousand concurrent writers and exactly right for a beta: no
// index to define, no collection to fan out, and one fetch to read a whole
// session's story.

import { firestoreConfigured, journalRead, journalWrite, journalList } from './firestore.js';

// Bounded so one long session cannot grow past Firestore's 1MB document limit.
// The oldest lines go first; the cost totals are never trimmed.
const MAX_LINES = 400;
const PREVIEW = 160;

const now = () => new Date().toISOString();

export const journalOn = () => firestoreConfigured();

const short = (s) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > PREVIEW ? t.slice(0, PREVIEW - 1) + '…' : t;
};

// USD per million tokens. Kept here rather than fetched because a price that
// silently changes under a cost report is worse than one that is a month stale
// and visible in a diff.
//
// Checked 2026-09-04. Update these when the rate card moves, and note it.
export const RATES = {
  'claude-sonnet-5': { in: 2.0, out: 10.0, cacheRead: 0.20, cacheWrite: 2.50 },
  'claude-opus-5':   { in: 8.0, out: 40.0, cacheRead: 0.80, cacheWrite: 10.0 },
  'claude-haiku-4-5':{ in: 1.0, out: 5.0,  cacheRead: 0.10, cacheWrite: 1.25 },
  'z-ai/glm-5.3':    { in: 0.40, out: 1.60, cacheRead: 0.08, cacheWrite: 0.50 },
  // Anything unrecognised is costed as Sonnet, which errs high rather than
  // reporting a suspiciously cheap beta.
  _default:          { in: 2.0, out: 10.0, cacheRead: 0.20, cacheWrite: 2.50 },
};

const rateFor = (model) => {
  const m = String(model || '');
  for (const k of Object.keys(RATES)) if (k !== '_default' && m.includes(k)) return RATES[k];
  return RATES._default;
};

export function priceOf(model, u) {
  const r = rateFor(model);
  return (
    (u.in || 0) * r.in +
    (u.out || 0) * r.out +
    (u.cacheRead || 0) * r.cacheRead +
    (u.cacheWrite || 0) * r.cacheWrite
  ) / 1e6;
}

const blank = (session) => ({
  session,
  started: now(),
  last: now(),
  who: '',
  dest: '',
  lines: [],
  spend: {},       // provider -> { in, out, cacheRead, cacheWrite, calls, usd, model }
  errors: 0,
});

// Read, change, write. Serialised per session inside one function invocation so
// two notes in the same request cannot lose each other; across invocations a
// collision costs one line, which is a price worth paying for not running a
// transaction on every keystroke.
const queues = new Map();
// A real Managed Agents session id is `sesn_` and about two dozen more
// characters. The test suite uses short stand-ins like `sesn_MEM`, and a local
// server holding the service account writes those straight into the same
// collection the beta figures come from. Cheap filter, keeps the numbers clean.
const realSession = (s) => typeof s === 'string' && /^sesn_.{16,}$/.test(s);
// The house ledger lives in the same collection, one document a month, holding
// the spend that belongs to no session. See addHouse below.
const HOUSE = /^house-\d{4}-\d{2}$/;
export const houseId = () => 'house-' + now().slice(0, 7);
const writable = (s) => realSession(s) || HOUSE.test(s);

// Local development shares Firestore with production, so without this a test
// run writes fake services and fake spend into the numbers the beta is priced
// on. It has happened twice — stub sessions on 2026-09-04 morning, and the
// house ledger the same evening — and both times the figures looked fine and
// were wrong. Set JOURNAL_LOCAL=1 to journal deliberately from a laptop.
const deployed = () => !!(process.env.VERCEL || process.env.JOURNAL_LOCAL);

async function edit(session, fn) {
  if (!deployed() || !writable(session) || !firestoreConfigured()) return null;
  const prev = queues.get(session) || Promise.resolve();
  const run = prev.then(async () => {
    const j = (await journalRead(session)) || blank(session);
    j.session = session;
    j.last = now();
    fn(j);
    if (j.lines.length > MAX_LINES) j.lines = j.lines.slice(-MAX_LINES);
    await journalWrite(session, j);
    return j;
  }).catch((e) => { console.error('journal:', e && e.message); return null; });
  queues.set(session, run.catch(() => {}));
  return run;
}

/**
 * One thing that happened. Never awaited by a request handler.
 *
 * `dedupe` names a field that makes this line unique — pass it and a second
 * line with the same event and the same value of that field is dropped. The
 * poll loop re-observes finished work on every pass, so without it a build that
 * ended once is written down forty times.
 */
export function note(session, ev, data, dedupe) {
  return edit(session, (j) => {
    if (dedupe && data && data[dedupe] != null) {
      const seen = j.lines.some((l) => l.ev === ev && l[dedupe] === data[dedupe]);
      if (seen) return;
    }
    const line = { t: now(), ev };
    for (const k of Object.keys(data || {})) {
      const v = data[k];
      if (v == null || v === '') continue;
      line[k] = typeof v === 'string' ? short(v) : v;
    }
    j.lines.push(line);
    if (ev === 'error' || ev === 'build.error') j.errors++;
    if (data && data.who) j.who = short(data.who);
    if (data && data.dest) j.dest = short(data.dest);
  });
}

/**
 * Token usage, as a TOTAL for that provider rather than a delta.
 *
 * The chat agent's usage is read back out of its own event log, which is
 * cumulative and gets re-read on every poll — adding deltas there would count
 * the same tokens once per poll. Writing the total is idempotent, which is the
 * only property that matters when the caller runs every two seconds.
 */
export function spendTotal(session, provider, model, u, usd) {
  return edit(session, (j) => {
    j.spend[provider] = {
      model: model || '',
      in: u.in || 0,
      out: u.out || 0,
      cacheRead: u.cacheRead || 0,
      cacheWrite: u.cacheWrite || 0,
      searches: u.searches || 0,
      calls: u.calls || 0,
      // The provider's own figure when it gives one, because it knows about
      // charges no token count can show — web searches, most of all. The rate
      // table is the fallback, and the reason the number stays explainable.
      usd: usd != null ? +Number(usd).toFixed(6) : +priceOf(model, u).toFixed(6),
      priced: usd != null ? 'provider' : 'estimated',
    };
  });
}

/**
 * Everything a request billed, from the meter, plus who was signed in.
 *
 * Added rather than replaced, because a request is a discrete event — unlike
 * the chat agent's log, which restates a running total.
 *
 * `who` is folded in here rather than written by its own call so that a request
 * which spent nothing and belongs to a person we already know about costs no
 * Firestore round trip at all. Every API route calls this on every request; the
 * common case has to be free.
 */
const knownWho = new Map();

export function addMetered(session, tally, who) {
  const rows = tally ? Object.keys(tally) : [];
  const fresh = who && knownWho.get(session) !== who;
  if (!rows.length && !fresh) return null;
  if (fresh) knownWho.set(session, who);
  return edit(session, (j) => {
    if (who) j.who = short(who);
    for (const k of rows) {
      const t = tally[k];
      const p = j.spend[k] || { calls: 0, failed: 0, usd: 0, metered: true };
      p.metered = true;
      p.calls += t.calls || 0;
      p.failed = (p.failed || 0) + (t.failed || 0);
      p.usd = +((p.usd || 0) + (t.usd || 0)).toFixed(6);
      if (t.unknown) p.unknown = true;
      j.spend[k] = p;
    }
  });
}

/**
 * Spend nobody can be billed for, into this month's house ledger.
 *
 * Serving a photo out of a shared itinerary is the case: the URL is cached and
 * shared on purpose, so the request has no session and guessing one would put
 * real money against the wrong person. It goes here instead, so the total stays
 * honest and the report can say plainly how much of the bill is overheads.
 */
export function addHouse(tally) {
  if (!tally || !Object.keys(tally).length) return null;
  const id = houseId();
  return edit(id, (j) => {
    j.house = true;
    for (const k of Object.keys(tally)) {
      const t = tally[k];
      const p = j.spend[k] || { calls: 0, failed: 0, usd: 0, metered: true };
      p.metered = true;
      p.calls += t.calls || 0;
      p.failed = (p.failed || 0) + (t.failed || 0);
      p.usd = +((p.usd || 0) + (t.usd || 0)).toFixed(6);
      if (t.unknown) p.unknown = true;
      j.spend[k] = p;
    }
  });
}

/**
 * Usage from one call, for a provider that reports per call rather than in a
 * log. Tokens accumulate; `u.usd`, when the provider gives one, accumulates
 * alongside them and the rate table is not consulted at all.
 *
 * OpenRouter returns its own charge in every response, so the builder's cost is
 * a fact rather than an estimate — and the estimate must not also be written,
 * or the two land on the same row and the build reads as twice its price.
 */
export function spendAdd(session, provider, model, u) {
  return edit(session, (j) => {
    const p = j.spend[provider] || { model: model || '', in: 0, out: 0, cacheRead: 0, cacheWrite: 0, calls: 0, usd: 0 };
    p.model = model || p.model;
    p.in += u.in || 0;
    p.out += u.out || 0;
    p.cacheRead += u.cacheRead || 0;
    p.cacheWrite += u.cacheWrite || 0;
    p.calls += u.calls || 1;
    if (u.usd != null) {
      p.real = +((p.real || 0) + Number(u.usd)).toFixed(6);
      p.usd = p.real;
      p.priced = 'provider';
    } else if (p.priced !== 'provider') {
      p.usd = +priceOf(p.model, p).toFixed(6);
      p.priced = 'estimated';
    }
    j.spend[provider] = p;
  });
}

/**
 * Bill this session for whatever it has spent since it was last billed.
 *
 * Derived, not accumulated: the charge is (what the session has cost) minus
 * (what has already been charged for it), both held on the same document. That
 * shape is deliberate — the builder's cost was once counted twice because an
 * estimate and the provider's real figure were written by two different
 * callers, and a running total that anything can add to invites exactly that
 * again. There is one number here and one writer.
 *
 * Runs inside edit(), so it is serialised against every other write to this
 * session and two concurrent requests cannot both bill the same dollar.
 *
 * Returns what to take off the ledger, or null when there is nothing to take.
 */
export async function journalSettle(session, convert) {
  let out = null;
  await edit(session, (j) => {
    const total = totalUsd(j);
    const already = Number(j.chargedUsd) || 0;
    const delta = +(total - already).toFixed(6);
    // A tenth of a cent. Below this the Firestore write costs more attention
    // than the money is worth, and it will be picked up on the next request.
    if (delta < 0.001) return;
    const credits = convert(delta);
    if (!credits) return;
    j.chargedUsd = +total.toFixed(6);
    j.chargedCredits = (Number(j.chargedCredits) || 0) + credits;
    out = { who: j.who || '', usd: delta, credits, totalCredits: j.chargedCredits };
  });
  return out;
}

export const totalUsd = (j) =>
  Object.keys((j && j.spend) || {}).reduce((a, k) => a + (j.spend[k].usd || 0), 0);

export { journalRead as read, journalList as list };
