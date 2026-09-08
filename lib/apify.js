// Apify: a rented browser for the two prices we cannot get any other way.
//
// raffy, 2026-09-08: "lets try to get google travel access with apify. try to
// set it up for detail lookup like flight tickets and hotels." And, setting the
// budget for it in the same breath: "yes just use apify for exact live rates
// that we can get ourself. only when necessary."
//
// WHAT THIS IS FOR, AND WHAT IT IS NOT FOR.
//
// Every other price source in this app is a cache or an estimate. Travelpayouts
// holds fares people have already looked up; LockTrip holds a room inventory
// that is often thin. Both are free and instant and neither knows what Google
// is showing right now — which is what somebody about to book actually wants.
//
// Apify runs a real scraper on somebody else's machine and bills per run. So it
// is the LAST thing tried, never the first: the agent asks for a price, the
// free sources answer, and only when they come back empty AND the traveller is
// at the point of booking does this get to spend money. A run is cached in
// Firestore afterwards, because the second person asking about the same hotel
// on the same nights should not pay for it twice.
//
// THE ACTOR IDS ARE SETTINGS, NOT CONSTANTS, and that is deliberate.
//
// This session cannot reach api.apify.com — the environment's egress policy
// blocks it — so nothing here has been run against the real service, and I will
// not write an actor name into the code as though it had. The store has several
// Google Flights scrapers of varying quality and price, and picking one is a
// decision to make with its output in front of you. `apifyFlightsActor` and
// `apifyHotelsActor` in the config document name whichever wins; until they are
// set, every function here returns null and the app behaves exactly as it did
// before. See the probes at the bottom and pages/api/health.js for the loop
// that fills them in.

import { fetchWith } from './net.js';
import { setting } from './settings.js';

const API = 'https://api.apify.com/v2';

// A scraper run is slow by nature — it is a browser loading a page. Long enough
// to be worth waiting for, short enough that a chat turn does not die on it.
const T_RUN = 90000;
const T_META = 20000;

export const apifyToken = () => setting('APIFY_TOKEN', 'apifyToken', '');
export const apifyReady = () => !!apifyToken();

// Apify writes actor ids as `username~actorname` in a URL and `username/actorname`
// everywhere a human reads one. Accept either.
const actorPath = (id) => encodeURIComponent(String(id || '').trim().replace('/', '~'));

export const flightsActor = () => setting('APIFY_FLIGHTS_ACTOR', 'apifyFlightsActor', '');
export const hotelsActor = () => setting('APIFY_HOTELS_ACTOR', 'apifyHotelsActor', '');

async function get(path, timeout = T_META) {
  const res = await fetchWith(API + path + (path.includes('?') ? '&' : '?')
    + 'token=' + encodeURIComponent(apifyToken()), timeout, {
    headers: { accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error('apify ' + res.status + ' ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

/**
 * Run an actor and get its results in one call.
 *
 * run-sync-get-dataset-items is the whole reason this fits in a serverless
 * function: start, wait, and return the dataset in a single request, with no
 * run id to poll and no state to keep between invocations.
 */
export async function runActor(actorId, input, { limit = 20, timeout = T_RUN } = {}) {
  if (!apifyReady()) return { error: 'no apify token' };
  if (!actorId) return { error: 'no actor configured' };
  const url = API + '/acts/' + actorPath(actorId) + '/run-sync-get-dataset-items'
    + '?token=' + encodeURIComponent(apifyToken())
    + '&timeout=' + Math.round(timeout / 1000)
    + '&limit=' + limit;
  try {
    const res = await fetchWith(url, timeout + 10000, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input || {}),
    });
    const text = await res.text();
    if (!res.ok) return { error: 'apify ' + res.status + ' ' + text.slice(0, 300) };
    const items = JSON.parse(text || '[]');
    return { items: Array.isArray(items) ? items : [items] };
  } catch (err) {
    return { error: String((err && err.message) || err).slice(0, 200) };
  }
}

// --- reading whatever the actor decided to call things ---------------------
//
// Every scraper names its fields differently and none of them is wrong. Rather
// than pin this to one actor's schema — which is how a working integration
// silently breaks the day somebody swaps the actor — each value is looked for
// under the names it plausibly has. Anything not found is left out rather than
// guessed at.

const first = (o, keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((x, part) => (x == null ? x : x[part]), o);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

// A price arrives as a number, as "RM 1,240", or as { amount, currency } —
// often all three from the same actor on different rows. Unwrapped here rather
// than by listing every nested path above, because the nesting is the part that
// varies most and the alternative is a key list that grows forever.
const money = (v) => {
  if (v && typeof v === 'object') {
    return money(first(v, ['amount', 'value', 'price', 'total', 'raw']));
  }
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const n = Number(String(v == null ? '' : v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** One flight row, in the shape lib/prices.js already knows how to print. */
export function asFare(x) {
  const price = money(first(x, ['price', 'price.amount', 'totalPrice', 'fare', 'cost', 'priceValue']));
  if (!price) return null;
  return {
    price,
    currency: first(x, ['currency', 'price.currency', 'priceCurrency']) || '',
    airline: first(x, ['airline', 'airlines.0', 'carrier', 'airlineName', 'legs.0.airline']) || '',
    flight_number: first(x, ['flightNumber', 'flight_number', 'legs.0.flightNumber']) || '',
    departure_at: first(x, ['departureTime', 'departure_at', 'departure', 'legs.0.departureTime']) || '',
    return_at: first(x, ['returnTime', 'return_at', 'legs.1.departureTime']) || '',
    transfers: first(x, ['stops', 'transfers', 'stopCount']),
    duration: first(x, ['duration', 'totalDuration', 'flightDuration']) || '',
    link: first(x, ['url', 'link', 'bookingUrl', 'deepLink']) || '',
  };
}

/** One hotel row: a name, a nightly rate if the actor gives one, and a link. */
export function asRoom(x) {
  const price = money(first(x, ['price', 'price.amount', 'rate', 'nightlyPrice',
    'pricePerNight', 'totalPrice', 'priceValue']));
  return {
    name: first(x, ['name', 'hotelName', 'title']) || '',
    price,
    currency: first(x, ['currency', 'price.currency', 'priceCurrency']) || '',
    // Whether that figure is a night or the whole stay is the single most
    // dangerous ambiguity in a hotel price, so it is carried rather than
    // assumed, and the caller says which it is or says it does not know.
    per: first(x, ['pricePerNight', 'nightlyPrice']) !== undefined ? 'night'
      : (first(x, ['totalPrice']) !== undefined ? 'stay' : ''),
    rating: first(x, ['rating', 'reviewScore', 'score']),
    reviews: first(x, ['reviewsCount', 'reviewCount', 'numberOfReviews']),
    address: first(x, ['address', 'location.address', 'fullAddress']) || '',
    link: first(x, ['url', 'link', 'bookingUrl', 'hotelUrl']) || '',
  };
}

/**
 * Live fares, if an actor is configured and it answers.
 *
 * Returns null rather than throwing on every failure path. The caller's job is
 * to carry on with the free sources, not to explain a scraper to a traveller.
 */
export async function liveFares(q) {
  const actor = flightsActor();
  if (!actor || !apifyReady()) return null;
  const out = await runActor(actor, {
    // The input names below are the ones most Google Flights actors use. An
    // actor that wants different ones is configured by changing the actor, not
    // by editing this — see apifyInput in the config document.
    ...JSON.parse(setting('APIFY_FLIGHTS_INPUT', 'apifyFlightsInput', '{}') || '{}'),
    origin: q.from,
    destination: q.to,
    departureDate: q.date,
    ...(q.back ? { returnDate: q.back } : {}),
    adults: q.adults || 1,
    currency: 'MYR',
    maxResults: 10,
  }, { limit: 10 });
  if (out.error || !out.items || !out.items.length) return null;
  const rows = out.items.map(asFare).filter(Boolean);
  return rows.length ? rows : null;
}

/** Live room rates, same contract. */
export async function liveRooms(q) {
  const actor = hotelsActor();
  if (!actor || !apifyReady()) return null;
  const out = await runActor(actor, {
    ...JSON.parse(setting('APIFY_HOTELS_INPUT', 'apifyHotelsInput', '{}') || '{}'),
    search: [q.hotel, q.city].filter(Boolean).join(', '),
    location: q.city || '',
    checkIn: q.checkIn,
    checkOut: q.checkOut,
    adults: q.adults || 2,
    currency: 'MYR',
    maxItems: 8,
  }, { limit: 8 });
  if (out.error || !out.items || !out.items.length) return null;
  const rows = out.items.map(asRoom).filter((r) => r.name || r.price);
  return rows.length ? rows : null;
}

// --- probes ----------------------------------------------------------------
//
// The loop for choosing an actor, run from the deployment because that is the
// only place that can reach Apify. All three are behind the admin key.

/** Does the token work, and whose is it? Free. */
export async function apifyProbe() {
  if (!apifyReady()) return { ready: false, why: 'no token' };
  try {
    const me = await get('/users/me');
    const u = (me && me.data) || {};
    return {
      ready: true,
      user: u.username || u.id || '',
      plan: (u.plan && (u.plan.id || u.plan.name)) || '',
      // What is left to spend, which is the number that decides whether this is
      // worth using at all.
      monthlyUsageUsd: (u.plan && u.plan.monthlyUsageCreditsUsd) || undefined,
      flightsActor: flightsActor() || '(not set)',
      hotelsActor: hotelsActor() || '(not set)',
    };
  } catch (err) {
    return { ready: false, why: String((err && err.message) || err).slice(0, 200) };
  }
}

/** What the store has for a search term, cheapest first. Free. */
export async function apifyStore(query, limit = 8) {
  if (!apifyReady()) return { error: 'no token' };
  try {
    const d = await get('/store?search=' + encodeURIComponent(query) + '&limit=' + limit);
    const items = ((d && d.data && d.data.items) || []).map((a) => ({
      id: (a.username || '') + '/' + (a.name || ''),
      title: a.title || '',
      runs: (a.stats && a.stats.totalRuns) || 0,
      users: (a.stats && a.stats.totalUsers) || 0,
      // Apify's pricing model is the thing that decides whether we can afford
      // to call it on a chat turn.
      pricing: (a.currentPricingInfo && a.currentPricingInfo.pricingModel) || '',
      pricePerUnitUsd: (a.currentPricingInfo && a.currentPricingInfo.pricePerUnitUsd) || undefined,
    }));
    return { items };
  } catch (err) {
    return { error: String((err && err.message) || err).slice(0, 200) };
  }
}

/** Run one actor with one input and hand back what it actually returned. */
export async function apifyTry(actorId, input, limit = 3) {
  const out = await runActor(actorId, input, { limit });
  if (out.error) return out;
  return {
    got: out.items.length,
    // The RAW first item. The normalisers above are guesses about field names
    // until something real has been read, and this is how they stop being
    // guesses.
    sample: out.items[0] || null,
    keys: out.items[0] && typeof out.items[0] === 'object' ? Object.keys(out.items[0]) : [],
    asFare: out.items[0] ? asFare(out.items[0]) : null,
    asRoom: out.items[0] ? asRoom(out.items[0]) : null,
  };
}
