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
import { research, researchReady } from './research.js';
import { rates as locktripRates } from './locktrip.js';
import { toMyr } from './facts.js';

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
//
// IT ALSO STOPPED POINTING AT HOTELLOOK. raffy, 2026-09-07: "we are using
// shitty sites." Hotellook is the service Travelpayouts shut down — its API
// went first and the consumer search is the same dying property, so the "book a
// hotel" row on everybody's To do list was sending them somewhere thin. It goes
// to Booking.com now, on their exact dates, which is the same page the rate is
// read off so the number and the link finally agree.
//
// The affiliate marker does not travel with it — it is a Travelpayouts id and
// means nothing on Booking's own domain. That costs nothing today: the marker
// is empty by raffy's decision on 2026-09-02, "i dont need to earn now. i just
// want my website to work, the prices etc."
export function hotelSearchLink({ city, where, hotel, checkIn, checkOut, adults = 2 }) {
  const w = clean(city || where);
  if (!w) return '';
  const q = new URLSearchParams({
    ss: [clean(hotel), w].filter(Boolean).join(', '),
    group_adults: String(Math.max(1, Math.min(9, adults))),
    no_rooms: '1', selected_currency: 'MYR',
  });
  if (DATE.test(clean(checkIn))) q.set('checkin', checkIn);
  if (DATE.test(clean(checkOut))) q.set('checkout', checkOut);
  return 'https://www.booking.com/searchresults.html?' + q;
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

// HOTELLOOK IS CLOSED, so a hotel rate is now READ OFF A PAGE.
//
// raffy, 2026-09-06: "i ask for flight it returns answer. but for Sheraton
// hotel it says it can't and give the link instead."
//
// The reason was not a bug. `/api/health?hotelhosts=1` tried fourteen endpoints
// across three hosts, http and https, including paths straight out of
// Travelpayouts' own documentation, and every one returned 404 — because
// Travelpayouts closed Hotellook and disabled its API outright. Their FAQ says
// no other hotel brand in their catalogue offers one to partners. Aviasales is
// a different brand, which is exactly why flights kept answering.
//
// So there is no hotel price API to point at, and raffy chose the remaining
// route: "yeah build it." Firecrawl renders the booking page — dates and all,
// in the URL — and the research worker reads the rate out of it. Verified
// working from the deployment before this was written: 13.3s, 12,019 chars.
//
// THREE THINGS THIS IS NOT, and the answer says so out loud:
//
//   - It is not a live availability quote. It is what a page published at the
//     moment we looked. Rooms sell and prices move.
//   - It is not guaranteed to find anything. A page behind a bot check or a
//     date picker comes back with nothing, and nothing is the honest answer —
//     the link goes out either way.
//   - It is not free. A page read is a Firecrawl credit plus a worker call,
//     which is roughly a tenth of a chat turn, and it takes ten to twenty
//     seconds. Worth it for a number; not worth doing speculatively.
//
// The old failure mode this must never return to: told it could not quote, the
// agent web-searched nightly rates and put numbers off aggregator pages on the
// cards as if they were the hotel's price. One of those was a different
// property in the same town. A rate scraped out of a search result is not a
// live rate — which is why the worker below is told to report only what the
// page actually shows for these exact dates, and to say nothing otherwise.

/** The booking page for one property on one set of dates, rate included. */
export function bookingPageFor({ hotel, city, checkIn, checkOut, adults = 2 }) {
  const who = clean(hotel) || clean(city);
  if (!who || !DATE.test(clean(checkIn)) || !DATE.test(clean(checkOut))) return '';
  const q = new URLSearchParams({
    ss: [clean(hotel), clean(city)].filter(Boolean).join(', '),
    checkin: checkIn, checkout: checkOut,
    group_adults: String(Math.max(1, Math.min(9, adults))),
    no_rooms: '1', selected_currency: 'MYR',
  });
  return 'https://www.booking.com/searchresults.html?' + q;
}

/**
 * The pages that actually carry a rate for these exact dates.
 *
 * SEARCHING WORDS IS NOT ENOUGH, and the first live test proved it. Told to
 * find DoubleTree by Hilton Melaka for 28-29 September, the agent searched
 * three times, read hilton.com, then answered "typically runs around RM480 a
 * night ... ranging from RM265-RM480" — an unsourced guess, which is the one
 * thing it is never allowed to do. Meanwhile raffy's own screenshot of the
 * Google Hotels page for those dates lists MYR 378, 406, 432 and 436 by room.
 *
 * The difference is not the search engine. It is that a rate lives on a page
 * whose URL contains the dates, and a word search does not land there. So we
 * build those URLs and hand them over: fetch, do not guess.
 */
export function ratePagesFor({ hotel, city, checkIn, checkOut, adults = 2 }) {
  const who = [clean(hotel), clean(city)].filter(Boolean).join(', ');
  if (!who || !DATE.test(clean(checkIn)) || !DATE.test(clean(checkOut))) return [];
  const ad = String(Math.max(1, Math.min(9, adults)));
  return [
    {
      // What he did by hand. One page, every platform's price, per room.
      site: 'Google Hotels',
      url: 'https://www.google.com/travel/search?' + new URLSearchParams({
        q: who, checkin: checkIn, checkout: checkOut,
        curr: 'MYR', hl: 'en', gl: 'my',
      }),
    },
    {
      site: 'Booking.com',
      url: bookingPageFor({ hotel, city, checkIn, checkOut, adults }),
    },
    {
      site: 'Agoda',
      url: 'https://www.agoda.com/search?' + new URLSearchParams({
        textToSearch: who, checkIn, los: String(nights(checkIn, checkOut)),
        adults: ad, rooms: '1',
      }),
    },
  ].filter((x) => x.url);
}

const nights = (a, b) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86400000) || 1);

/**
 * The LockTrip answer, in ringgit, or null if it could not give one.
 *
 * Tried before anything else, because it is an API: it either answers or says
 * it did not. It cannot be handed a bot challenge and mistake that for a hotel
 * with no rooms, which is what the page-reading it replaced did for weeks.
 */
async function fromLocktrip(q, link) {
  const where = clean(q.city || q.where);
  const hotel = clean(q.hotel);
  const r = await locktripRates({
    city: where, hotel,
    checkIn: q.checkIn, checkOut: q.checkOut,
    adults: q.adults || 2, children: q.children || 0,
  }).catch(() => null);
  if (!r || !r.ok || !r.hotels.length) return null;
  // A named hotel it does not carry is not an answer about that hotel. Fall
  // through to the agent's own search rather than showing four neighbours.
  if (hotel && !r.askedFound) return null;

  // LockTrip quotes in dollars and raffy's travellers think in ringgit, so the
  // conversion happens here, once, and is labelled as ours. Without a rate the
  // figures still go out — in their own currency, named — because a real number
  // in the wrong currency is recoverable and no number is not.
  const fx = await toMyr(r.unit).catch(() => 0);
  const money = (n) => (fx ? 'RM' + Math.round(n * fx) : r.unit + ' ' + n.toFixed(2));
  const row = (h) => '  ' + [
    h.name,
    h.stars ? h.stars + '★' : '',
    money(h.perNight) + '/night',
    '(' + money(h.total) + ' for the ' + r.nights + ')',
    h.score ? h.score + '/10 on LockTrip (' + h.reviews + ' reviews)' : '',
    h.refundable ? 'free cancellation' : '',
  ].filter(Boolean).join(' · ');

  const head = (hotel ? hotel + ', ' : '') + where + ', ' + q.checkIn + ' to ' + q.checkOut;
  const out = [head + '  (LockTrip, live, read just now)'];
  out.push('  ' + r.total + ' places available in ' + r.place + ' on these dates'
    + (r.low && r.high && r.low.perNight !== r.high.perNight
      ? ', most between ' + money(r.low.perNight) + ' and ' + money(r.high.perNight) + ' a night.'
      : '.'));
  // The outright dearest is kept out of the range and mentioned separately: one
  // mis-keyed whole-property listing turned "RM36 to RM52" into "RM36 to
  // RM9480", which is true of the data and useless to a traveller.
  if (r.max && r.high && r.max.perNight > r.high.perNight * 1.5) {
    out.push('  (A few go far higher — the dearest is ' + money(r.max.perNight)
      + ' a night. Keep that out of the range; it is one listing, usually a whole house.)');
  }
  out.push('');
  out.push(...r.hotels.slice(0, 6).map(row));
  out.push('');
  out.push('  PER NIGHT where it says /night, WHOLE ' + r.nights + '-night STAY in brackets.'
    + ' Do not swap them.');
  out.push(fx
    ? '  LockTrip quotes in ' + r.unit + '; the ringgit is our conversion at today\'s rate,'
      + ' so say "about", and name LockTrip as the source.'
    : '  In ' + r.unit + ' — the exchange rate could not be checked, so quote the currency as'
      + ' shown and say you could not convert it.');
  out.push('  If they want a specific hotel that is not listed here, SEARCH FOR IT:'
    + ' you have web_search and web_fetch, and a search for the hotel and the dates'
    + ' returns nightly rates per room across the booking sites.');
  out.push('  book: ' + link);
  return out.join('\n');
}

async function hotelPrices(q) {
  const where = clean(q.city || q.where);
  const hotel = clean(q.hotel);
  const link = hotelSearchLink({ ...q, city: where, hotel });
  if (!where && !hotel) return 'need a city';
  if (!DATE.test(clean(q.checkIn)) || !DATE.test(clean(q.checkOut))) {
    return 'need checkIn and checkOut as YYYY-MM-DD';
  }

  // ONE LIVE SOURCE, THEN THE AGENT'S OWN SEARCH. Nothing else.
  //
  // raffy, 2026-09-07: "i want u remove all the so called Agoda booking and we
  // just did ... I can't understand how something so simple can't be done. u
  // see I just google double tree Hilton melaka rates date bla bla and it gives
  // out the prices with room across all platform. why cnt anthropic do the same
  // ... go with default first. don't go too advance cause u can't handle it in
  // the past."
  //
  // Fair, and the last clause is the honest part. Reading Booking.com, Agoda
  // and Google Hotels through a scraper was three ways to be handed a bot
  // challenge and report it as "no rooms". That whole path is deleted. What is
  // left is the thing that works: an API when it has the town, and otherwise
  // the search engine, which is what he did by hand in ten seconds.
  const live = await fromLocktrip(q, link || '').catch(() => null);
  if (live) return live;

  const head = (hotel ? hotel + ', ' : '') + where + ', ' + q.checkIn + ' to ' + q.checkOut;
  const pages = ratePagesFor({ hotel, city: where, checkIn: q.checkIn, checkOut: q.checkOut, adults: q.adults });
  return [head,
    '  The live inventory has no rate for this one. GO AND READ IT OFF THESE PAGES.',
    '  Use web_fetch on them, in this order, and stop at the first that shows a rate:',
    ...pages.map((x) => '    ' + x.site + ': ' + x.url),
    '',
    '  FETCH THESE URLS. Do not web_search for words instead — a rate lives on a page whose',
    '  URL carries the dates, and a word search lands on the hotel\'s marketing page or a',
    '  "best hotels in" article. Asked this before, a search came back with "typically around',
    '  RM480 a night" while the Google Hotels page for those exact dates was listing RM378,',
    '  RM406 and RM432 by room. Google Hotels first: it is one page carrying every',
    '  platform\'s price, which is what a person gets by googling the hotel and the dates.',
    '',
    '  THEN, quoting it:',
    '  - Name the site and say when you looked. "RM406 on Booking.com just now", never bare.',
    '  - Say PER NIGHT or WHOLE STAY for each figure, and never swap them.',
    '  - Give the room type where the page shows one — RM378 twin and RM436 king is a more',
    '    useful answer than one number.',
    '',
    '  IF NONE OF THEM SHOWS A RATE, SAY THAT. "I could not find a published rate for those',
    '  dates" is a real answer and an acceptable one. A typical price, an approximate range,',
    '  or anything with "usually" or "around" in it is NOT — you would be inventing the',
    '  number people book on. Hand them the link instead.',
    '  - And a site with no rooms is that site having no rooms. Never call a hotel fully',
    '    booked without naming what you checked and when.',
    '  book: ' + (link || (pages[0] && pages[0].url) || 'no link — give me the city too')].join('\n');
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
    'What flights and hotels actually cost on their dates, right now. Use it before you quote any travel or accommodation price — an average from a blog post is not an answer to "what will it cost me on 14 October". Flights need IATA codes; work them out from the cities. Call it once per route or city rather than per message: these are live lookups, and the answer does not change between two turns of the same conversation. READ THE DATES IN THE ANSWER: the fare provider often has nothing on the exact day and answers with nearby ones instead. When it says NOTHING on their date, tell them that plainly — never present a fare from another day as theirs. Fares on other dates are worth mentioning only as "if you could move by a day or two, it is RM X on the 14th".',
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
        description: 'CALL THIS FIRST for any hotel price question — before place_details,'
          + ' before any web search, before your own memory. Rates come from LockTrip, a live'
          + ' inventory of 2.5M properties, which very often has the exact hotel on the exact'
          + ' dates.'
          + ' When it does not carry the hotel or the town, the answer TELLS YOU TO SEARCH.'
          + ' Do that: web_search for "<hotel> rates <check-in> to <check-out>" returns'
          + ' nightly rates per room across the booking sites — the same thing a person gets'
          + ' by googling it — and web_fetch reads the best page for the detail.'
          + ' Whichever way the number arrives: NAME THE SITE AND WHEN YOU LOOKED, never a'
          + ' bare number. Say whether each figure is PER NIGHT or for the WHOLE STAY and'
          + ' repeat it that way — a stay total quoted as nightly makes a trip look several'
          + ' times too expensive. Never take a rate off a blog or a "best hotels in X"'
          + ' article: that is last year\'s price for a different room. And never say a place'
          + ' is fully booked on one look — a site with no rooms is that site having no'
          + ' rooms; check another, and name what you checked.',
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
