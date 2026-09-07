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
import { setting } from './settings.js';

// WHAT CURRENCY THE NUMBERS ARE IN, and why this is a setting.
//
// `currency` on hotel_search does nothing. Asking for MYR and asking for USD
// returned byte-identical figures, and the `currency` field that comes back on
// each hotel is an echo of what was sent: omit it from the request and it
// vanishes from the response entirely. So the API hands over a number with no
// trustworthy unit attached — precisely the shape of the Hotellook bug that
// quoted a whole-stay total as a nightly rate.
//
// CALIBRATED AGAINST A HOTEL WE KNOW THE PRICE OF. My first reading was USD,
// from the cheap end of Kuching, where the figures fit dollars and were absurd
// as ringgit. That ruled out MYR but could not separate USD from EUR — sixteen
// percent apart, and budget rooms are not precise enough to tell.
//
// raffy's screenshot settles it much better. DoubleTree by Hilton Melaka,
// 28-29 September, on Google Hotels: RM378 twin, RM406 on Booking.com, RM436
// king. LockTrip returns 80.36 for that hotel on those dates.
//
//   as EUR -> about RM394, sitting between the twin and the king
//   as USD -> about RM323, below every published rate on the page
//
// A wholesale seller can be under the public rate, so USD is not impossible.
// But EUR lands inside the actual spread, and locktrip.com's own header runs in
// EUR. One good calibration point beats the inference it replaces.
//
// It stays a setting because that is still an inference: LOCKTRIP_CURRENCY in
// the environment, or locktripCurrency in the config document, and the fix for
// being wrong is a config change rather than a deploy. If a rate here ever
// reads consistently high or low against a page, this is the dial.
export const baseCurrency = () => setting('LOCKTRIP_CURRENCY', 'locktripCurrency', 'EUR');

const API = 'https://locktrip.com/mcp/tools/';
const T_CALL = 12000;
// hotel_search fans out to suppliers before it answers, and a big city takes
// far longer than a small one: Kuching came back in well under a second, Paris
// and Singapore both timed out at 12s. Give the search its own budget.
const T_SEARCH = 25000;

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
 * Resolve a place, and a property inside it, in one lookup.
 *
 * search_location types EVERYTHING as "CITY" — the city itself and each hotel
 * in it — so the type field cannot tell them apart. The ID can: a city is a
 * plain 24-character id, a property is `<cityId>_<hotelId>`. That is also how a
 * named hotel gets matched exactly later, by id rather than by comparing
 * strings, which is what used to put a Desaru search in another town.
 *
 * A property id is NOT a narrower search. Passing "Hilton Kuching"'s id to
 * hotel_search returns all 411 hotels in Kuching, so the property is found by
 * filtering the results, not by asking for less.
 */
export async function place(query) {
  const q = clean(query);
  if (!q) return null;
  const j = await call('search_location', { query: q });
  const list = (j && j.locations) || [];
  if (!list.length) return null;

  // NEVER TAKE list[0] ON TRUST. Asking for "Sheraton, Kuching" put Hilton
  // Kuching at the top — their matcher answers with the nearest thing it has
  // rather than nothing — and taking the first row silently turned a question
  // about one hotel into an answer about a different one. That is the same
  // failure as the Desaru search that returned another town, and it is worse
  // here because the reply looks right.
  //
  // So a row only counts as the property asked for if its name actually
  // contains the distinctive words of the query. When none does, fall back to
  // the plain city id and let the caller say the property was not found.
  const words = q.toLowerCase().split(/[^a-z0-9]+/i)
    .filter((w) => w.length > 3 && !/^(hotel|resort|suites?|the|and|inn)$/.test(w));
  const named = list.find((l) => {
    const nm = String(l.fullName || l.name || '').toLowerCase();
    return words.length && words.every((w) => nm.includes(w));
  });
  const cityOnly = list.find((l) => !String(l.id || '').includes('_'));
  const pick = named || cityOnly || list[0];
  const [cityId, hotelId] = String(pick.id || '').split('_');
  return {
    cityId,
    hotelId: hotelId || '',
    name: pick.fullName || pick.name || q,
    // Whether their matcher actually found what was asked for, or just handed
    // back the nearest thing it had.
    matched: !!named,
    // A bare city id means the query named a town; a suffixed one means it
    // named a property, and then the town is still where we search.
    isProperty: !!hotelId,
  };
}

/**
 * Live rates for a place on real dates.
 *
 * Returns `{ ok, hotels, unit, nights, total, why }`. `ok: false` is never a
 * throw — every caller has a fallback, and a rate lookup that takes the
 * conversation down with it is worse than one that says it could not answer.
 */
export async function rates({
  city, hotel, checkIn, checkOut, adults = 2, children = 0,
  nationality = 'MY', limit = 8,
}) {
  const where = clean(city);
  const name = clean(hotel);
  const unit = baseCurrency();
  const no = (why, extra) => ({ ok: false, why, hotels: [], unit, ...extra });

  if (!where && !name) return no('need a city');
  if (!DATE.test(clean(checkIn)) || !DATE.test(clean(checkOut))) {
    return no('need checkIn and checkOut as YYYY-MM-DD');
  }
  // Their API rejects a past check-in outright, with a message that reads like
  // a fault rather than a date problem. Say it properly here.
  if (checkIn < new Date().toISOString().slice(0, 10)) {
    return no('that check-in date has already passed');
  }

  const n = nights(checkIn, checkOut);
  try {
    // Ask about the property when there is one — that resolves the town AND
    // the hotel id in a single call. Fall back to the town on its own.
    const found = (name && await place(name + (where ? ', ' + where : '')))
      || (where && await place(where));
    if (!found || !found.cityId) return no('could not find "' + (name || where) + '" as a place');

    const started = await call('hotel_search', {
      regionId: found.cityId,
      startDate: checkIn,
      endDate: checkOut,
      rooms: [{
        adults: Math.max(1, Math.min(4, adults)),
        ...(children > 0 ? { childrenAges: Array(Math.min(4, children)).fill(8) } : {}),
      }],
      nationality,
    }, T_SEARCH);
    const searchKey = started && started.searchKey;
    if (!searchKey) return no('the search did not start');

    // Poll until the suppliers have answered, or until we have waited as long
    // as a conversation can stand. Whatever has arrived by then is the answer:
    // hotels come in as suppliers reply, and forty of them is already one.
    //
    // NO `filters`. Sending one — even the documented `filters.hotelName` —
    // comes back 400 VALIDATION_ERROR, which would have failed every lookup
    // for a named hotel. The name is matched here instead, on the hotel id.
    //
    // AND ASK FOR ALL OF THEM WHEN A HOTEL IS NAMED. This is what made the app
    // say it could not find DoubleTree by Hilton Melaka while LockTrip was
    // carrying it the whole time: one page of the 200 CHEAPEST out of 961, and
    // a five-star is never in the cheapest 200 of a city whose floor is RM20.
    // The search reported the property by name in `place` and then the row was
    // simply off the end of the page I read.
    //
    // `size` goes to 5000, so a named hotel takes the whole city and finds it
    // by id. The unnamed case stays at 200 — that is a browse, and the cheapest
    // 200 sorted by price is exactly the right thing to browse.
    const want = found.isProperty && found.hotelId ? found.hotelId : '';
    let page = null;
    for (let i = 0; i < POLL_MAX; i++) {
      page = await call('get_search_results', {
        searchKey, page: 0, size: want ? 2000 : 200, sortBy: 'PRICE_ASC',
      }, want ? T_SEARCH : T_CALL);
      if (String((page && page.searchStatus) || '').toUpperCase() === 'COMPLETED') break;
      if (i < POLL_MAX - 1) await new Promise((r) => setTimeout(r, POLL_MS));
    }

    const all = (page && page.hotels) || [];
    const rows = all.map(shape(n, unit));
    const total = Number(page && page.totalCount) || rows.length;

    // THE TOP OF THE RANGE NEEDS ITS OWN PAGE. One PRICE_ASC page of 200 out of
    // 451 hotels gives the cheapest 200, so its last row is the ceiling of the
    // cheap half, not of the market — and calling that "the range" understates
    // what a town costs. One more read (get_search_results is 30/minute, not
    // 5) buys the real one.
    //
    // AND THE VERY TOP IS NOT THE TOP OF THE RANGE. The dearest row in Kuching
    // was a single 4-star "staycation" listing at 2357 a night, five times the
    // next one — a whole-property or mis-keyed row, the kind every inventory
    // has. Quoted straight it produced "hotels in Kuching run from RM36 to
    // RM9480 a night", which is true of the data and useless to a traveller.
    // So take ten from the dear end and use the fifth: still the expensive end
    // of the market, no longer one bad row. The real maximum travels alongside
    // it, for the rare case where somebody wants it.
    const dearRows = total > rows.length
      ? await call('get_search_results', { searchKey, page: 0, size: 10, sortBy: 'PRICE_DESC' })
        .then((d) => ((d && d.hotels) || []).map(shape(n, unit)))
        .catch(() => [])
      : [];
    const dear = dearRows[Math.min(4, dearRows.length - 1)] || null;
    const dearest = dearRows[0] || null;
    if (!rows.length) {
      return no('no rooms came back for those dates', { nights: n, place: found.name });
    }

    // The property they asked about goes first, and when it is not there we say
    // so rather than showing the cheapest thing nearby. "How much is the
    // Sheraton" answered with four other hotels is not an answer.
    const asked = want ? rows.find((r) => r.id === want) : null;
    const rest = rows.filter((r) => r !== asked);

    return {
      ok: true,
      why: '',
      // Whether the named property was actually found, so the caller can be
      // honest about it instead of quietly substituting a neighbour.
      asked: name ? (asked || null) : null,
      askedFor: name,
      // Said plainly so the caller never presents a neighbour as the answer.
      askedFound: !!asked,
      hotels: [...(asked ? [asked] : []), ...rest].slice(0, limit),
      // The floor and the ceiling of what came back, which is the "price range
      // from a trusted source" raffy asked for.
      low: rows[0], high: dear || rows[rows.length - 1], max: dearest,
      unit,
      nights: n,
      total,
      place: found.name,
      status: (page && page.searchStatus) || '',
      raw: { keys: Object.keys(page || {}), first: all[0] || null },
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
 * THIS IS THE FIELD THAT GETS QUOTED WRONG, and now it is measured rather than
 * assumed. The same Kuching hotel came back at 8.92 for a one-night search and
 * 26.95 for a three-night one: 8.92 x 3 = 26.76. `minPrice` is the WHOLE STAY.
 *
 * Hotellook's `priceAvg` was the same and was quoted as a nightly rate, which
 * made a four-night trip look four times too expensive. So the division happens
 * once, here, and both numbers travel onward with a label on each — nothing
 * downstream has to remember which is which.
 */
const shape = (n, unit) => (h) => {
  const total = Number(h.minPrice) || 0;
  const was = Number(h.originalPrice) || 0;
  return {
    name: clean(h.name),
    stars: Number(h.starRating) > 0 ? Number(h.starRating) : 0,
    total, perNight: total ? +(total / n).toFixed(2) : 0,
    // Their reading of the best price on competing sites. Only worth repeating
    // when it is actually higher — an "original" equal to the price, which is
    // most of them, is noise rather than a saving.
    was: was > total ? was : 0,
    unit,
    score: Number(h.reviewScore) || 0,
    reviews: Number(h.reviewCount) || 0,
    address: clean(h.address),
    lat: Number(h.latitude) || null,
    lon: Number(h.longitude) || null,
    photo: (h.images || [])[0] || '',
    id: clean(h.hotelId),
    refundable: !!h.hasFreeCancellation,
  };
};

// The public tools, and the only ones anything here may call. Named rather than
// passed through so the diagnostic below cannot be turned into a general proxy.
export const PUBLIC_TOOLS = [
  'search_location', 'hotel_search', 'get_search_results',
  'get_hotel_rooms', 'get_hotel_details', 'check_cancellation_policy',
];

/**
 * One public tool, raw, for the health endpoint.
 *
 * This exists because the API cannot be reached from the sandbox this app is
 * written in, and the question that decided the whole integration — what
 * currency is `minPrice` actually in, given that asking for MYR and asking for
 * USD return the same number — could only be answered by trying it.
 */
export async function rawTool(name, body) {
  if (!PUBLIC_TOOLS.includes(name)) return { error: 'not a public tool' };
  try { return await call(name, body || {}); } catch (err) {
    return { error: String((err && err.message) || err).slice(0, 300) };
  }
}

/** For the health probe: prove the API answers, and with what. */
export async function locktripProbe(q) {
  const t0 = Date.now();
  const out = await rates(q);
  return { seconds: +((Date.now() - t0) / 1000).toFixed(1), ...out };
}
