// A hotel price API, at last — instead of reading somebody's booking page.
//
// raffy, 2026-09-07: "that's the issue. I've checked myself. booking.com on the
// dates at del Rio give results. its says booking.com says its unavailable.
// what's our mechanism to find real rates? it worked before I think. can you
// try this method. https://locktrip.com/agents"
//
// He was right on both counts, and the second sentence is the one that matters.
//
// WHY THE SCRAPE LIED. The health probe reported "12,019 chars" off Booking's
// search page and I called it working. Those characters were Booking's bot
// interstitial — the head carries `chal_t=` and
// `force_referer=https://www.google.com/` — plus the empty search chrome, with
// not one hotel name in them. Firecrawl got a challenge page; the worker
// truthfully reported no prices; the agent turned that into "unavailable". The
// hotel had rooms the whole time.
//
// 12,000 is also exactly the cut scrape() applies, so even on a clean fetch the
// listings on a results page can sit past the truncation. Two independent ways
// for the same lookup to come back empty and honest about it.
//
// Neither is fixable by trying harder. Scraping a site that does not want to be
// scraped is a race we lose on their schedule, and it is why this was quietly
// answering "fully booked" for weeks.
//
// WHAT LOCKTRIP GIVES US. A real API: 2.5M properties, JSON in and JSON out,
// and — the part that decides it — search needs no key and no account at all.
// No credential to leak from a public repo, nothing for raffy to sign up for,
// nothing to expire. It also returns `originalPrice`, their reading of the best
// price on the competing sites, so a quote can carry a comparison rather than a
// bare number.
//
// LIMITS, because they shape the code below:
//   - hotel_search is 5/minute per IP anonymous. Vercel lambdas share egress
//     IPs, so a 429 is a normal outcome, not an incident. It falls back.
//   - Search is asynchronous: hotel_search hands back a searchKey and
//     get_search_results is polled until searchStatus is COMPLETED. A chat turn
//     cannot wait forever, so the poll is bounded and a partial result is
//     returned rather than nothing — hotels arrive as suppliers answer, and
//     twenty of them is already an answer.
//   - Check-in must be in the future. A past date is rejected outright.
//
// Docs: https://locktrip.com/agents/docs

import { fetchWith } from './net.js';

const API = 'https://locktrip.com/mcp/tools/';
const T_CALL = 12000;

// How long a rate lookup may spend waiting for suppliers. The agent is holding
// a conversation open behind this; past about fifteen seconds the traveller has
// decided the app is broken.
const POLL_MS = 1200;
const POLL_MAX = 8;

const clean = (s) => String(s == null ? '' : s).trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const nights = (a, b) =>
  Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86400000) || 1);

/** One tool call. Throws with a readable reason; callers decide what to do. */
async function call(name, body, ms = T_CALL) {
  const r = await fetchWith(API + name, ms, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch (e) { /* reported below */ }
  if (!r.ok) {
    // Their envelope: branch on the code, never the message. `recoverable`
    // false means retrying this exact call is pointless.
    const d = (j && j.error && j.error.data) || {};
    const err = new Error(name + ' ' + r.status + ' ' + (d.mcpCode || clean(text).slice(0, 120)));
    err.status = r.status;
    err.mcpCode = d.mcpCode || '';
    err.recoverable = d.recoverable !== false;
    throw err;
  }
  if (!j) throw new Error(name + ': answered but not JSON');
  return j;
}

/**
 * The region id for a place. Prefers a CITY over a hotel or a landmark: a
 * region id built from a property name searches around that property, which is
 * how "Desaru" once came back showing hotels in another town.
 */
export async function regionFor(place) {
  const q = clean(place);
  if (!q) return null;
  const j = await call('search_location', { query: q });
  const list = (j && j.locations) || [];
  if (!list.length) return null;
  const city = list.find((l) => String(l.type || '').toUpperCase() === 'CITY');
  return city || list[0];
}

/**
 * Live rates for a place on real dates.
 *
 * Returns `{ ok, hotels, currency, nights, status, why }`. `ok: false` is never
 * a throw — every caller here has a fallback, and a rate lookup that takes the
 * conversation down with it is worse than one that says it could not answer.
 */
export async function rates({
  city, hotel, checkIn, checkOut, adults = 2, children = 0,
  currency = 'MYR', nationality = 'MY', limit = 8,
}) {
  const where = clean(city);
  const name = clean(hotel);
  const no = (why, extra) => ({ ok: false, why, hotels: [], currency, ...extra });

  if (!where) return no('need a city');
  if (!DATE.test(clean(checkIn)) || !DATE.test(clean(checkOut))) {
    return no('need checkIn and checkOut as YYYY-MM-DD');
  }
  // Their API rejects a past check-in outright, and the message that comes back
  // reads like a fault rather than a date problem. Say it properly here.
  const today = new Date().toISOString().slice(0, 10);
  if (checkIn < today) return no('that check-in date has already passed');

  const n = nights(checkIn, checkOut);
  try {
    const region = await regionFor(where);
    if (!region) return no('could not find "' + where + '" as a place');

    const started = await call('hotel_search', {
      regionId: region.id,
      startDate: checkIn,
      endDate: checkOut,
      currency,
      rooms: [{
        adults: Math.max(1, Math.min(4, adults)),
        ...(children > 0 ? { childrenAges: Array(Math.min(4, children)).fill(8) } : {}),
      }],
      nationality,
    });
    const searchKey = started && started.searchKey;
    if (!searchKey) return no('the search did not start');

    // Poll until the suppliers have answered, or until we have waited as long
    // as a conversation can stand. Whatever has arrived by then is the answer.
    let page = null;
    for (let i = 0; i < POLL_MAX; i++) {
      page = await call('get_search_results', {
        searchKey,
        page: 0,
        size: Math.max(limit, 40),
        currency,
        sortBy: 'PRICE_ASC',
        ...(name ? { filters: { hotelName: name } } : {}),
      });
      const done = String((page && page.searchStatus) || '').toUpperCase() === 'COMPLETED';
      if (done) break;
      if (i < POLL_MAX - 1) await new Promise((r) => setTimeout(r, POLL_MS));
    }

    const all = (page && page.hotels) || [];
    // A name filter that matched nothing is worth knowing about: it means the
    // property is not in this region's inventory, which is a different answer
    // from "the town has no rooms".
    if (name && !all.length) {
      const wide = await call('get_search_results', {
        searchKey, page: 0, size: 40, currency, sortBy: 'PRICE_ASC',
      }).catch(() => null);
      const near = ((wide && wide.hotels) || []).slice(0, limit).map(shape(n, currency));
      return {
        ok: near.length > 0,
        why: 'no property matching "' + name + '" in ' + where,
        hotels: near, currency, nights: n, asked: name,
        status: (page && page.searchStatus) || '',
      };
    }

    return {
      ok: all.length > 0,
      why: all.length ? '' : 'no rooms came back for those dates',
      hotels: all.slice(0, limit).map(shape(n, currency)),
      currency,
      nights: n,
      status: (page && page.searchStatus) || '',
      place: region.fullName || region.name || where,
    };
  } catch (err) {
    return no(err.status === 429
      ? 'rate limited — too many lookups in the last minute'
      : String((err && err.message) || err).slice(0, 160));
  }
}

/**
 * One hotel row, with the per-night figure worked out here.
 *
 * THIS IS THE FIELD THAT GETS QUOTED WRONG. Hotellook's `priceAvg` was the
 * whole stay and was quoted as a nightly rate, which made a four-night trip
 * look four times too expensive. `minPrice` here is the total for the stay, so
 * the division happens once, in one place, and both numbers travel together
 * with a label on each. Nothing downstream has to remember which is which.
 */
const shape = (n, currency) => (h) => {
  const total = Number(h.minPrice) || 0;
  const was = Number(h.originalPrice) || 0;
  return {
    name: clean(h.name),
    stars: Number(h.starRating) || 0,
    total, perNight: total ? Math.round(total / n) : 0,
    // Their reading of the best price on the competing sites. Only worth
    // repeating when it is actually higher — an "original" below the price is
    // noise, not a saving.
    was: was > total ? was : 0,
    wasPerNight: was > total ? Math.round(was / n) : 0,
    currency,
    address: clean(h.address),
    lat: Number(h.latitude) || null,
    lon: Number(h.longitude) || null,
    photo: (h.images || [])[0] || '',
    id: clean(h.hotelId),
  };
};

/** For the health probe: prove the API answers, and with what. */
export async function locktripProbe(q) {
  const t0 = Date.now();
  const out = await rates(q);
  return { seconds: +((Date.now() - t0) / 1000).toFixed(1), ...out };
}
