// Every billed service, per person, without anyone having to remember.
//
// raffy, 2026-09-04: "builder is nil because it's using open router. find a way
// so that we can track everything not just agent but all the services we use.
// per person, with real insights that could help us monitor and decide how to
// price our service in future."
//
// He is right that nil was an instrumentation hole rather than a free lunch,
// and the general version of that complaint is the one worth designing for: any
// scheme where a service gets counted because somebody remembered to add a line
// at its call site will be wrong again the next time a service is added.
//
// So the meter does not live at the call sites. Every outbound request in this
// app goes through fetchWith() in lib/net.js — one chokepoint, checked — and
// that is where the counting happens. A service added next month is billed on
// the day it is added, by nobody.
//
// The session comes from AsyncLocalStorage rather than from an argument. The
// alternative is threading a session id through twenty function signatures that
// have no other use for it, and the first one anybody forgets goes silently
// uncounted, which is the bug we are fixing.

import { AsyncLocalStorage } from 'async_hooks';

// null in the browser, where next.config.js stubs async_hooks out. Every
// function below is a no-op then, which is right: the browser's requests are
// the user's own and cost us nothing.
const store = typeof AsyncLocalStorage === 'function' ? new AsyncLocalStorage() : null;
const here = () => (store ? store.getStore() : null);

// USD per request. Checked 2026-09-04 against Google's own pricing pages;
// update these when the rate card moves and say so in the log.
//
// `skip` means the service reports its real cost somewhere better than a
// per-call guess, and is written down there instead: Anthropic's own figure
// comes out of its session usage (spendTotal in lib/journal.js), OpenRouter's
// out of every response body (spendAdd). Counting them here as well would
// price the two most expensive things in the app twice.
// `free` still gets counted, because volume is worth seeing even at zero.
const BOOK = [
  { host: 'api.anthropic.com', service: 'chat', skip: true },
  { host: 'openrouter.ai', service: 'builder', skip: true },

  // Places. The photo endpoint and the search endpoint are different SKUs and
  // differ by a factor of five, so they are priced apart.
  { host: 'places.googleapis.com', path: '/media', service: 'places.photo', usd: 0.007 },
  { host: 'places.googleapis.com', service: 'places.search', usd: 0.032 },

  { host: 'routes.googleapis.com', service: 'routes', usd: 0.005 },
  { host: 'maps.googleapis.com', service: 'maps', usd: 0.005 },

  // Ours, and effectively free at this size — but the call counts say whether
  // a session is hammering something, which is half of what a support question
  // needs.
  { host: 'firestore.googleapis.com', service: 'firestore', usd: 0 },
  { host: 'storage.googleapis.com', service: 'storage', usd: 0 },
  { host: 'oauth2.googleapis.com', service: 'auth', usd: 0 },

  // Free, on purpose, and worth being able to prove.
  { host: 'maps.wikimedia.org', service: 'maptile', usd: 0 },
  { host: 'commons.wikimedia.org', service: 'commons', usd: 0 },
  { host: 'api.openverse.org', service: 'openverse', usd: 0 },
  { host: 'api.open-meteo.com', service: 'weather', usd: 0 },
  { host: 'archive-api.open-meteo.com', service: 'weather', usd: 0 },
  { host: 'date.nager.at', service: 'holidays', usd: 0 },
  { host: 'open.er-api.com', service: 'fx', usd: 0 },
  { host: 'api.travelpayouts.com', service: 'affiliate', usd: 0 },
];

const LOCAL = /^(localhost|127\.|\[?::1\]?$|0\.0\.0\.0$|.*\.invalid$|.*\.local$)/i;

function look(url) {
  let u;
  try { u = new URL(String(url)); } catch (e) { return null; }
  let loose = null;
  for (const r of BOOK) {
    if (r.host !== u.hostname) continue;
    if (r.path) { if (u.pathname.includes(r.path)) return r; continue; }
    loose = loose || r;
  }
  if (loose) return loose;
  // Nothing on this machine is ever billed to us, and the test suite calls both
  // of these on purpose. Counting them puts fake services in the report's
  // "not priced yet" column, which is the one column that has to mean something.
  if (LOCAL.test(u.hostname)) return null;
  // Anything else not in the book is still counted, under its own hostname, at
  // zero. A service nobody priced showing up in the report is the point: it is
  // how the next unbilled thing gets noticed.
  return { host: u.hostname, service: 'other:' + u.hostname, usd: 0, unknown: true };
}

/** Run `fn` with everything it does attributed to this session. */
export function withSession(session, fn) {
  if (!store) return fn();
  return store.run({ session, tally: new Map() }, fn);
}

/** The session the current request belongs to, if it is inside withSession. */
export const currentSession = () => (here() || {}).session || '';

// Spend that belongs to nobody in particular.
//
// /api/photo is the case this exists for: the URL in an itinerary is shared and
// cached on purpose, so a request for it carries no session and must not be
// guessed at. It is still real money, and a total that quietly omits it is a
// total that will be wrong in the direction that flatters us.
//
// Batched rather than written per request, because this is the one endpoint hot
// enough that a Firestore round trip per image would cost more than the image.
const house = new Map();
let houseCalls = 0;

function add(tally, r, ok) {
  const row = tally.get(r.service) || { calls: 0, failed: 0, usd: 0, unknown: !!r.unknown };
  row.calls++;
  if (ok === false) row.failed++;
  // A failed call is usually still billed by Google, and pretending otherwise
  // would understate exactly the sessions that went wrong.
  row.usd += r.usd || 0;
  tally.set(r.service, row);
}

/**
 * One outbound request happened. Called from fetchWith, so nothing else has to
 * remember. Cheap: a Map update, no I/O.
 */
export function count(url, ok) {
  const r = look(url);
  if (!r || r.skip) return;
  const s = here();
  if (s && s.session) return add(s.tally, r, ok);
  add(house, r, ok);
  houseCalls++;
}

/** How much unattributed spend is waiting to be written down. */
export const housePending = () => houseCalls;

/** The house tally, if it is worth a write yet. Cleared when taken. */
export function drainHouse(force) {
  if (!house.size || (!force && houseCalls < 25)) return null;
  const out = {};
  for (const [k, v] of house) out[k] = { ...v, usd: +v.usd.toFixed(6) };
  house.clear();
  houseCalls = 0;
  return out;
}

/** What this request spent, for the journal to fold in. Empty is common. */
export function drain() {
  const s = here();
  if (!s || !s.tally.size) return null;
  const out = {};
  for (const [k, v] of s.tally) out[k] = { ...v, usd: +v.usd.toFixed(6) };
  s.tally.clear();
  return out;
}
