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

// A scraper run is slow by nature — it is a browser loading a page. But it is
// being awaited INSIDE a chat turn, and that changes the maths completely.
//
// raffy, 2026-09-08: "also it makes asking chat question also get stuck."
//
// This was 90 seconds, plus 10 on the fetch around it. A turn answers its tool
// calls one after another in a single request, and that request has 300 seconds
// before the platform kills it — so two slow lookups could eat the whole budget,
// the request would die before the answers were sent, and the calls would stay
// pending forever. A conversation that cannot answer its own tool calls is a
// conversation that has stopped, and the build behind it never gets pumped
// either, because the code that pumps it is further down the same request.
//
// So: 25 seconds, and a setting rather than a constant, because the right
// number here is the one measured against real runs. A scraper that cannot
// answer in 25 seconds is not useful inside a conversation — the free sources
// and a link are a better answer than a turn that never finishes.
const T_RUN = () => {
  const n = Number(setting('APIFY_TIMEOUT_MS', 'apifyTimeoutMs', ''));
  return Number.isFinite(n) && n >= 5000 && n <= 60000 ? n : 25000;
};
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
export async function runActor(actorId, input, { limit = 20, timeout = T_RUN() } = {}) {
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
    // Never index INTO a string. "airlines.0" against airlines: "THAI" returns
    // "T", and an airline called T is the kind of wrong that reads as a typo
    // rather than a bug. Caught by the test that replays the actor's real row.
    const v = k.split('.').reduce((x, part) => (
      x == null || typeof x === 'string' ? undefined : x[part]), o);
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

// One name, whether the actor sent one or a list of them.
const name = (v) => (Array.isArray(v) ? String(v[0] || '') : String(v == null ? '' : v));

/** One flight row, in the shape lib/prices.js already knows how to print. */
export function asFare(x) {
  const price = money(first(x, ['price', 'price.amount', 'totalPrice', 'fare', 'cost', 'priceValue']));
  if (!price) return null;
  return {
    price,
    currency: first(x, ['currency', 'price.currency', 'priceCurrency']) || '',
    // `airlines` is a string on some actors and a list on others. Either way
    // one name comes out — never an array printed as "AirAsia,Scoot".
    airline: name(first(x, ['airline', 'airlines', 'carrier', 'airlineName', 'legs.0.airline'])),
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

// THE ENVELOPE. Both actors return ONE item wrapping a list, not a list of
// items, and the wrapper is where the best part is.
//
// Read off real output on 2026-09-08 rather than guessed at — see the errand
// loop in lib/chores.js for how, given this session cannot reach Apify itself.
//
// Flights come back as { all_flights: [...], price_insights: {...} }, and
// price_insights is the answer to the thing raffy actually asked for: Google's
// own `typical_price_range` for that route on those dates, next to today's
// lowest. "RM977, and the usual range is RM840-1,050" is a better sentence than
// any single number, because it says whether now is a good time to book.
//
// Hotels come back as { property_details: { rate_per_night, total_rate, prices,
// ... } }, and it settles the ambiguity this app has been dancing around for a
// week: rate_per_night AND total_rate, both labelled, both extracted as numbers.

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
    // Snake case, SerpApi's Google Flights names. The actor said so itself when
    // asked in camelCase, which is the only reason this is right.
    departure_id: String(q.from || '').toUpperCase(),
    arrival_id: String(q.to || '').toUpperCase(),
    outbound_date: q.date,
    ...(q.back ? { return_date: q.back } : {}),
    adults: q.adults || 1,
    currency: 'MYR',
    max_pages: 1,
  }, { limit: 1 });
  if (out.error || !out.items || !out.items.length) return null;

  const env = out.items[0] || {};
  if (env.error) return null;
  const list = env.all_flights || env.best_flights || env.other_flights || [];
  const rows = list.map((x) => {
    const f = asFare(x);
    if (!f) return null;
    return {
      ...f,
      airline: f.airline || x.airlines || '',
      departure_at: x.departure_time || f.departure_at,
      arrival_at: x.arrival_time || '',
      transfers: x.stops != null ? x.stops : f.transfers,
      best: x.category === 'best',
    };
  }).filter(Boolean);

  const ins = env.price_insights || {};
  const range = Array.isArray(ins.typical_price_range) ? ins.typical_price_range : null;
  return {
    rows: rows.slice(0, 6),
    lowest: Number(ins.lowest_price) || (rows[0] && rows[0].price) || null,
    // "typical", "low" or "high" — Google's own read on today's price, and the
    // one piece of advice here that nobody else in the app can give.
    level: ins.price_level || '',
    range: range && range.length === 2 ? range : null,
    currency: (rows[0] && rows[0].currency) || 'MYR',
  };
}

/** Live room rates, same contract. */
export async function liveRooms(q) {
  const actor = hotelsActor();
  if (!actor || !apifyReady()) return null;
  // WHAT KIND OF PLACE, NOT JUST WHICH TOWN.
  //
  // raffy, 2026-09-08: "make sure the agent write correct things not too
  // generic. write like luxury hotel in Venice etc. u know what i mean?"
  //
  // The query was the town and nothing else, so Google answered the way it
  // answers "Venice" — whatever is nearest and biggest, which is how a family
  // asking for a quiet guesthouse got four business hotels by the station. The
  // agent already knows what they want by the time it prices anything; `style`
  // is where it says so, and it goes in front of the town exactly as a person
  // would type it.
  const plain = [q.hotel, q.city].filter(Boolean).join(', ');
  const search = q.hotel ? plain
    : [q.style, q.style ? 'in' : '', q.city].filter(Boolean).join(' ').trim() || plain;
  const out = await runActor(actor, {
    q: search,
    check_in_date: q.checkIn,
    check_out_date: q.checkOut,
    adults: q.adults || 2,
    children: 0,
    currency: 'MYR',
    max_pages: 1,
  }, { limit: 1 });
  if (out.error || !out.items || !out.items.length) return null;

  const env = out.items[0] || {};
  if (env.error) return null;
  const one = (p) => {
    if (!p) return null;
    const night = p.rate_per_night || {};
    const stay = p.total_rate || {};
    return {
      name: p.name || '',
      // Two figures, each labelled, because RM543 a night and RM2,173 for the
      // stay are the same booking and a different answer.
      perNight: Number(night.extracted_lowest) || null,
      totalStay: Number(stay.extracted_lowest) || null,
      beforeTax: Number(night.extracted_before_taxes_fees) || null,
      currency: 'MYR',
      rating: p.overall_rating,
      reviews: p.reviews,
      stars: p.extracted_hotel_class || p.hotel_class || '',
      address: p.address || '',
      link: p.link || '',
      // WHO is selling it at that price. A rate with no source is the thing
      // this app has been told twice not to produce.
      sources: (p.prices || p.featured_prices || []).slice(0, 4)
        .map((x) => ({ site: x.source || '', link: x.link || '' }))
        .filter((x) => x.site),
    };
  };
  const named = one(env.property_details);
  const list = (env.properties || []).map(one).filter(Boolean);
  const rows = [named, ...list].filter((r) => r && (r.perNight || r.totalStay || r.name));
  return rows.length ? rows.slice(0, 5) : null;
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
