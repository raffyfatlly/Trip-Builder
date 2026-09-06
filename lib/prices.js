// Real prices, and links that pay for themselves.
//
// raffy, 2026-09-01: "we can not just give average price but give real time
// price based on date they want to book flight or hotel etc." Then: "pick the
// suggested price provider."
//
// The provider is **Travelpayouts**, chosen over the alternatives for one
// reason that outranks the rest: it is the only one where the link on the card
// is revenue rather than cost. Amadeus's self-service tier was decommissioned
// in July 2026, so the obvious free route is gone. Duffel is self-serve and
// excellent but charges per order and per search, and it makes you the merchant
// — a decision about becoming a travel agency, not a decision about prices.
// SerpApi is fastest to real numbers and pure expense. Booking.com's Demand API
// is pilot-partners-only.
//
// Travelpayouts is free to join, covers flights AND hotels across 60+ brands
// including Booking and Agoda, and pays commission on what people book through
// it. Given the app now puts a link on every card and every task, that turns
// the arranging phase from a cost centre into the business.
//
// TWO CREDENTIALS, and they are deliberately independent:
//
//   TRAVELPAYOUTS_MARKER — the affiliate id. Links alone need nothing else, so
//     the moment this is set every "Book it" button starts earning. No API
//     call, no rate limit, nothing to fail.
//   TRAVELPAYOUTS_TOKEN  — the API token, for actual prices on actual dates.
//
// Everything degrades in that order: with neither, links go to the public site;
// with the marker, they earn; with both, the agent can quote a real fare.

import { setting, snapshot, loadConfig } from './settings.js';
import { fetchWith } from './net.js';

const T_API = 9000;
const API = 'https://api.travelpayouts.com';
// Hotels are a DIFFERENT SERVICE on the same token.
//
// raffy, 2026-09-06, testing Kuching on his phone: "Live rate lookup isn't
// returning anything usable for Kuching right now (it's just spitting back
// unrelated flight data)" — and it was, literally. The hotel lookup called
// api.travelpayouts.com/v2/prices/latest, which is the AIRLINE TICKET endpoint.
// It answered with flights every time, and the parser below quietly looked for
// hotelName and priceAvg in them and found nothing.
//
// The giveaway was in the code all along: those field names are Hotellook's,
// so the intent was always this host. Same token, different service.
const HOTELS = 'https://engine.hotellook.com/api/v2';

// Also read from the NEXT_PUBLIC_ name: the marker is an affiliate id whose
// entire job is to sit in a URL somebody clicks, so it is public by design and
// the browser needs it to build booking links in the preview. The TOKEN is the
// opposite and never leaves the server.
// No marker until one is confirmed.
//
// 569622 came out of the Drive install snippet; his account footer shows ID
// 773073. Two numbers, one of them wrong, and a wrong marker earns nothing
// while looking exactly like a working one — the failure is silent and could
// sit there for months.
//
// raffy, 2026-09-02: "i dont need to earn now. i just want my website to work,
// the prices etc." So it goes back to empty. Links work fine without it; they
// just do not pay. When there is a real marker, set TRAVELPAYOUTS_MARKER and
// every link picks it up with no code change.
export const marker = () =>
  process.env.TRAVELPAYOUTS_MARKER || process.env.NEXT_PUBLIC_TRAVELPAYOUTS_MARKER
  || snapshot().travelpayoutsMarker || '';
// The token can arrive from the environment or from the config document. It is
// never in this file: the repo is public, and unlike a marker an API token can
// read and spend.
//
// Loaded once per warm function and then read synchronously, because token()
// is called from half a dozen places that are not worth making async. A cold
// start pays one Firestore read; every call after that pays nothing. The
// snapshot itself now lives in lib/settings.js, because the builder switches
// provider through the same document.
export { loadConfig };

export const token = () => setting('TRAVELPAYOUTS_TOKEN', 'travelpayoutsToken');
export const pricesReady = () => !!token();

const IATA = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (s) => String(s == null ? '' : s).trim();

// --- links ------------------------------------------------------------------
//
// These are the whole point of the "the link must be there" work: a person
// reading a task should be one tap from doing it. A marker-less link still
// works, it just does not earn — which is the right failure, because a dead
// button would be worse than an unpaid one.

function withMarker(url) {
  const m = marker();
  if (!m) return url;
  return url + (url.includes('?') ? '&' : '?') + 'marker=' + encodeURIComponent(m);
}

// Aviasales takes the whole search in the path: origin, ddmm, destination,
// ddmm, passengers. "KUL1410DAD2110" + 2 adults.
export function flightSearchLink({ from, to, date, back, adults = 1, children = 0 }) {
  const f = clean(from).toUpperCase();
  const t = clean(to).toUpperCase();
  if (!IATA.test(f) || !IATA.test(t) || !DATE.test(clean(date))) return '';
  const dm = (d) => d.slice(8, 10) + d.slice(5, 7);
  const path = f + dm(date) + t + (DATE.test(clean(back)) ? dm(back) : '')
    + Math.max(1, Math.min(9, adults)) + (children ? String(Math.min(9, children)) : '');
  return withMarker('https://www.aviasales.com/search/' + path);
}

// The destination is a PLACE. It is never a hotel name.
//
// raffy, 2026-09-02, on his Desaru trip: "its giving me pricing option in other
// places too . not desaru." He was right, and this is why. We were putting the
// property name into hotellook's `destination` — "Mandarin Oriental Desaru
// Coast, Johor" — and that parameter takes a city. Given a hotel name it cannot
// place, it fuzzy-matches to whatever it can, which is how a Desaru search
// comes back showing hotels somewhere else entirely.
//
// So the city is the destination, always, and the hotel name never touches it.
// Without a city we return nothing at all: a link to the wrong town is worse
// than no link, because it looks like an answer.
export function hotelSearchLink({ city, where, checkIn, checkOut, adults = 2 }) {
  const w = clean(city || where);
  if (!w) return '';
  const q = new URLSearchParams({ destination: w, adults: String(Math.max(1, adults)) });
  if (DATE.test(clean(checkIn))) q.set('checkIn', checkIn);
  if (DATE.test(clean(checkOut))) q.set('checkOut', checkOut);
  return withMarker('https://search.hotellook.com/?' + q);
}

// --- real prices -------------------------------------------------------------

async function flightPrices(q) {
  const from = clean(q.from).toUpperCase();
  const to = clean(q.to).toUpperCase();
  if (!IATA.test(from) || !IATA.test(to)) {
    return 'need IATA codes for both ends, e.g. KUL and DAD';
  }
  if (!DATE.test(clean(q.date))) return 'need a departure date as YYYY-MM-DD';

  const p = new URLSearchParams({
    origin: from, destination: to, departure_at: q.date,
    currency: 'myr', limit: '5', sorting: 'price', one_way: q.back ? 'false' : 'true',
    token: token(),
  });
  if (DATE.test(clean(q.back))) p.set('return_at', q.back);

  const ask = async (params) => {
    const r = await fetchWith(API + '/aviasales/v3/prices_for_dates?' + params, T_API);
    if (!r.ok) return { bad: 'flight prices unavailable (HTTP ' + r.status + ')' };
    const j = await r.json();
    return { rows: (j && j.data) || [] };
  };

  let got = await ask(p);
  if (got.bad) return got.bad;

  // Empty on the exact day is common and is NOT the same as "no flights".
  //
  // raffy, 2026-09-06: "It claim the flight search return nothing, again. But
  // good thing it gives the link. But that's unacceptable. I want it to give
  // back exact rates."
  //
  // The provider's cache is thin per-day and much better per-month, so asking
  // for the day and stopping was throwing away an answer it had. Ask again for
  // the MONTH, and let fareReport sort out what is actually on their date and
  // what is merely nearby — it already labels the difference.
  if (!got.rows.length) {
    const wide = new URLSearchParams(p);
    wide.set('departure_at', String(q.date).slice(0, 7));
    if (DATE.test(clean(q.back))) wide.set('return_at', String(q.back).slice(0, 7));
    wide.set('limit', '30');
    const second = await ask(wide);
    if (second.rows && second.rows.length) got = second;
  }
  return fareReport(got.rows, q, flightSearchLink(q));
}

/**
 * Turn Travelpayouts fare rows into something the agent can quote safely.
 *
 * raffy, 2026-09-06: "the flights fares never return the date then i want".
 *
 * He is right, and it is the API's own behaviour: `prices_for_dates` treats
 * `departure_at` as the START of a window and answers with the cheapest fares
 * it holds around it. Ask for the 12th and rows for the 14th, the 19th and the
 * 27th come back. The old code printed all of them under a heading that said
 * "KUL -> CNX, 2026-11-12", so a fare three weeks from their trip was labelled
 * as their date. That is the worst possible failure for this tool — a wrong
 * number is recoverable, a wrong number wearing the right date is not.
 *
 * So the rows are split. Fares actually ON the requested date are the answer.
 * Everything else is offered as what it is — other dates — clearly labelled and
 * only when there is nothing on the day, because a cheaper fare two days out is
 * genuinely useful to someone whose dates are not fixed yet.
 */
export function fareReport(rows, q, link) {
  const from = clean(q.from).toUpperCase();
  const to = clean(q.to).toUpperCase();
  const head = from + ' → ' + to + ', ' + q.date + (q.back ? ' returning ' + q.back : ' one way');
  // The link goes out even here. Somebody whose dates return nothing is exactly
  // the person who needs to go and look for themselves, and dropping it left
  // them with a dead end. Caught by setup/test-fares.mjs, not by reading it.
  if (!rows.length) {
    return [head, '  no fares found at all — say so rather than estimating',
      '  book: ' + link].join('\n');
  }

  const dayOf = (x) => String(x.departure_at || '').slice(0, 10);
  const backOf = (x) => String(x.return_at || '').slice(0, 10);
  // A row matches only if BOTH legs match, when both were asked for. A return
  // fare that leaves on the right day and comes back a week late is not their
  // fare.
  const onDate = rows.filter((x) => dayOf(x) === q.date
    && (!DATE.test(clean(q.back)) || !x.return_at || backOf(x) === q.back));
  const other = rows.filter((x) => !onDate.includes(x));

  const line = (x, withDate) => {
    const bits = ['RM' + Math.round(x.price).toLocaleString('en')];
    if (x.airline) bits.push(x.airline + (x.flight_number ? ' ' + x.flight_number : ''));
    // On-date rows show the time; off-date rows lead with the date, because the
    // date is the whole reason they are being shown separately.
    if (x.departure_at) {
      bits.push(withDate
        ? 'DEPARTS ' + dayOf(x) + (backOf(x) ? ', back ' + backOf(x) : '')
        : 'leaves ' + String(x.departure_at).slice(0, 16).replace('T', ' '));
    }
    if (x.transfers != null) bits.push(x.transfers ? x.transfers + ' stop' + (x.transfers > 1 ? 's' : '') : 'direct');
    return '  ' + bits.join('  ·  ');
  };

  const out = [head + (onDate.length ? '  (in ringgit)' : '')];
  if (onDate.length) {
    out.push(...onDate.slice(0, 5).map((x) => line(x, false)));
  } else {
    out.push('  NOTHING on ' + q.date + '. Do not quote any fare below as if it were their date.');
  }
  if (!onDate.length && other.length) {
    out.push('  Cheapest on OTHER dates in the same month — these are REAL fares, so give them:'
      + ' "nothing on the 12th, but it is RM X on the 14th if you can move".');
    out.push(...other.slice(0, 4).map((x) => line(x, true)));
  }
  out.push('  book: ' + link);
  return out.join('\n');
}

// HOTELLOOK IS CLOSED. There is no hotel price API here any more.
//
// raffy, 2026-09-06: "i ask for flight it returns answer. but for Sheraton
// hotel it says it can't and give the link instead."
//
// Flights worked and hotels did not, which looked like a bug in how the place
// was being passed. It was not. `/api/health?prices=` ran one real lookup from
// the deployment and came back 404; `?hotelhosts=1` then tried fourteen
// endpoints across three hosts, http and https, including paths straight out of
// Travelpayouts' own documentation. Every single one: 404.
//
// The reason is not a path. Travelpayouts closed Hotellook and disabled its API
// outright, and their own FAQ says no other hotel brand in their catalogue
// offers an API to partners — they will "let you know as soon as they have
// updates". Aviasales is a different brand and is untouched, which is exactly
// why flights still answer.
//
// So this no longer pretends. It does not call a dead host three times before
// giving up, and it does not report "no rates came back for those dates" —
// which read as "this town is quiet" when the truth is "there is no such
// service". It says what is true and hands over the booking link, which still
// works: Travelpayouts redirects those to a Booking.com search.
//
// If a hotel rate is wanted badly enough to pay for it, the options are a paid
// provider (SerpApi's Google Hotels, a Booking scraper) or reading the
// property's own page with Firecrawl, which is already wired in for research.
// Both are decisions, not fixes, so neither is made here.
async function hotelPrices(q) {
  const where = clean(q.city || q.where);
  if (!where) return 'need a city';
  const link = hotelSearchLink(q);
  return [where + (DATE.test(clean(q.checkIn)) ? ', ' + q.checkIn + ' to ' + q.checkOut : ''),
    '  NO LIVE HOTEL RATES EXIST for this app any more — the provider shut its hotel',
    '  API down. This is not a temporary outage and retrying will not help.',
    '  Tell them plainly that you cannot quote a nightly rate, give them the link,',
    '  and do NOT estimate one or go and find one by web search: a number off a blog',
    '  or an aggregator is not what it will cost them, and putting it on a card as',
    '  the price is worse than saying you do not know.',
    '  book: ' + (link || 'no link — give me the city, not the hotel name')].join('\n');
}

// `hotelReport()` used to live here — the parser that turned Hotellook rows
// into quotable lines. It is gone with the service. Two things it knew are
// worth carrying to whatever replaces it:
//
//   - `priceAvg` was the average for the WHOLE stay, not per night. Quoting it
//     as a nightly rate made a four-night trip look four times too expensive.
//     Whatever the next provider returns, check which one it means.
//   - The property they ASKED about goes first, and when it is not in the
//     results you say so rather than showing the cheapest thing nearby. "How
//     much is the Sheraton" answered with four other hotels is not an answer.

export const PRICE_TOOL = {
  type: 'custom',
  name: 'check_prices',
  description:
    'What FLIGHTS actually cost on their dates, right now, plus booking links for hotels. Use it before you quote any travel price — an average from a blog post is not an answer to "what will it cost me on 14 October". Flights need IATA codes; work them out from the cities. Call it once per route or city rather than per message: these are live lookups, and the answer does not change between two turns of the same conversation. READ THE DATES IN THE ANSWER: the fare provider often has nothing on the exact day and answers with nearby ones instead. When it says NOTHING on their date, tell them that plainly — never present a fare from another day as theirs. Fares on other dates are worth mentioning only as "if you could move by a day or two, it is RM X on the 14th".',
  input_schema: {
    type: 'object',
    properties: {
      flights: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'IATA code, e.g. KUL.' },
            to: { type: 'string', description: 'IATA code, e.g. DAD.' },
            date: { type: 'string', description: 'YYYY-MM-DD.' },
            back: { type: 'string', description: 'YYYY-MM-DD for the return. Leave out for one way.' },
            adults: { type: 'integer' },
            children: { type: 'integer' },
          },
          required: ['from', 'to', 'date'],
        },
      },
      hotels: {
        type: 'array',
        maxItems: 3,
        description: 'THERE ARE NO LIVE HOTEL RATES. The provider closed its hotel API'
          + ' and there is no replacement, so this returns a booking link and nothing else.'
          + ' Ask for one only when you want the link. Never promise a nightly rate, never'
          + ' estimate one, and never go and find one by web search — a number off a blog or'
          + ' an aggregator is not what it will cost them.',
        items: {
          type: 'object',
          properties: {
            city: {
              type: 'string',
              description: 'The town or area only — "Desaru Coast, Johor", "Hoi An", "Rome". NEVER a hotel name: this is a destination search, and a property name it cannot place comes back with hotels in a different town. If you want one specific hotel, put its name in `hotel` and give its own booking page from place_details instead.',
            },
            hotel: {
              type: 'string',
              description: 'Optional. The one property you are asking about, so the answer is labelled with it. It does not narrow the search — the city does.',
            },
            checkIn: { type: 'string', description: 'YYYY-MM-DD.' },
            checkOut: { type: 'string', description: 'YYYY-MM-DD.' },
            adults: { type: 'integer' },
          },
          required: ['city', 'checkIn', 'checkOut'],
        },
      },
    },
  },
};

export async function checkPrices(input) {
  await loadConfig();
  const flights = ((input && input.flights) || []).slice(0, 3);
  const hotels = ((input && input.hotels) || []).slice(0, 3);
  if (!flights.length && !hotels.length) return 'Nothing to price.';

  if (!pricesReady()) {
    // The links still work without a token, so hand those over rather than
    // returning nothing: a real booking page is worth more than a refusal.
    const links = [
      ...flights.map((f) => 'flights ' + f.from + '→' + f.to + ': ' + (flightSearchLink(f) || 'could not build a link')),
      ...hotels.map((h) => 'hotels in ' + (h.city || h.where) + (h.hotel ? ' (looking for ' + h.hotel + ')' : '')
        + ': ' + (hotelSearchLink(h) || 'could not build a link — give me the city, not the hotel name')),
    ];
    // "Do not estimate" was not enough on its own: told it could not quote,
    // the agent went and web-searched nightly rates instead and put numbers
    // off aggregator pages on the cards as if they were the hotel's price.
    // One of those searches was for a different property in the same town.
    // A rate scraped out of a search result is not a live rate, and presenting
    // it as one is the failure this tool exists to prevent.
    return ['Live prices are not configured, so I cannot quote a rate. Do NOT estimate one,',
      'and do NOT go and find one by web search either — a nightly rate off a blog or an',
      'aggregator page is not what it will cost them on their dates, and putting it on a card',
      'as the price is worse than saying you do not know.',
      'Give them these search links instead and say the price is whatever it shows today.',
      'For one named hotel, its own booking page from place_details beats any of these:',
      ...links].join('\n');
  }

  const out = await Promise.all([
    ...flights.map((f) => flightPrices(f).catch((e) => 'flight lookup failed: ' + e.message)),
    ...hotels.map((h) => hotelPrices(h).catch((e) => 'hotel lookup failed: ' + e.message)),
  ]);
  out.push('\nThese are live and they move. Quote them with the date you checked, put the booking link on the card, and never carry a fare forward into a later message as if it were still true.');
  return out.join('\n\n');
}

export async function checkPriceSource() {
  await loadConfig();
  if (!token()) return marker() ? 'links only (no token)' : 'not configured';
  try {
    const p = new URLSearchParams({
      origin: 'KUL', destination: 'SIN', currency: 'myr', limit: '1',
      one_way: 'true', token: token(),
    });
    const r = await fetchWith(API + '/aviasales/v3/prices_for_dates?' + p, T_API);
    if (!r.ok) return r.status === 401 ? 'token rejected' : 'HTTP ' + r.status;
    const j = await r.json();
    return j && j.success !== false ? 'ok' + (marker() ? '' : ' (no marker — links will not earn)') : 'answered but not ok';
  } catch (err) {
    return 'FAILED: ' + (err && err.message ? err.message : 'unknown');
  }
}


/**
 * One real lookup of each kind, reported side by side.
 *
 * These hosts are unreachable from the sandbox this app is written in, so
 * "does it work" used to be answerable only by asking raffy to try it in the
 * app and describe what he saw. This asks the deployment instead — and it is
 * what established that hotels were not misconfigured but discontinued, after
 * two wrong guesses at the host in one day.
 */
export async function priceProbe(city, hotel) {
  await loadConfig();
  if (!token()) return { ok: false, why: 'no token' };
  const out = {};
  // Flights, which do still work — so a failure here means the token, not the
  // provider, and the hotel line below can be read as its own problem.
  out.flights = await flightPrices({ from: 'KUL', to: 'KCH', date: '2026-10-14' })
    .catch((e) => 'threw: ' + e.message);
  out.hotels = await hotelPrices({
    city: city || 'Kuching', hotel: hotel || 'Sheraton',
    checkIn: '2026-10-14', checkOut: '2026-10-17',
  }).catch((e) => 'threw: ' + e.message);
  return out;
}
