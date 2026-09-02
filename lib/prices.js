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

import { fetchWith } from './net.js';

const T_API = 9000;
const API = 'https://api.travelpayouts.com';

// Also read from the NEXT_PUBLIC_ name: the marker is an affiliate id whose
// entire job is to sit in a URL somebody clicks, so it is public by design and
// the browser needs it to build booking links in the preview. The TOKEN is the
// opposite and never leaves the server.
// raffy's, baked in rather than configured. A marker is an affiliate id whose
// entire job is to sit in a URL somebody clicks — it is public by design, it
// carries no permission and it cannot be used to read or spend anything. He
// said so himself: "for this i dont mind its exposed."
//
// In the code rather than an env var because that is one fewer thing for him to
// do, and because an env var that is never going to change is a config setting
// pretending to be a secret. The env var still wins if it is set, so changing
// the marker later needs no deploy of this file.
const MARKER = '569622';

export const marker = () =>
  process.env.TRAVELPAYOUTS_MARKER || process.env.NEXT_PUBLIC_TRAVELPAYOUTS_MARKER || MARKER;
export const token = () => process.env.TRAVELPAYOUTS_TOKEN || '';
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

  const r = await fetchWith(API + '/aviasales/v3/prices_for_dates?' + p, T_API);
  if (!r.ok) return 'flight prices unavailable (HTTP ' + r.status + ')';
  const j = await r.json();
  const rows = (j && j.data) || [];
  if (!rows.length) return 'no fares found for those dates — say so rather than estimating';

  const lines = rows.slice(0, 5).map((x) => {
    const bits = ['RM' + Math.round(x.price).toLocaleString('en')];
    if (x.airline) bits.push(x.airline + (x.flight_number ? ' ' + x.flight_number : ''));
    if (x.departure_at) bits.push('leaves ' + String(x.departure_at).slice(0, 16).replace('T', ' '));
    if (x.transfers != null) bits.push(x.transfers ? x.transfers + ' stop' + (x.transfers > 1 ? 's' : '') : 'direct');
    return '  ' + bits.join('  ·  ');
  });
  return [from + ' → ' + to + ', ' + q.date + (q.back ? ' returning ' + q.back : ' one way')
    + '  (cheapest found, in ringgit)', ...lines,
    '  book: ' + flightSearchLink(q)].join('\n');
}

async function hotelPrices(q) {
  const where = clean(q.where);
  if (!where) return 'need a city or hotel name';
  if (!DATE.test(clean(q.checkIn)) || !DATE.test(clean(q.checkOut))) {
    return 'need checkIn and checkOut as YYYY-MM-DD';
  }
  const p = new URLSearchParams({
    location: where, checkIn: q.checkIn, checkOut: q.checkOut,
    currency: 'myr', limit: '5', token: token(),
  });
  const r = await fetchWith(API + '/v2/prices/latest?' + p, T_API);
  if (!r.ok) return 'hotel prices unavailable (HTTP ' + r.status + ')';
  const j = await r.json();
  const rows = (j && (j.results || j.data)) || [];
  const list = Array.isArray(rows) ? rows : Object.values(rows || {});
  if (!list.length) return 'no rates found for those dates — say so rather than estimating';

  const lines = list.slice(0, 5).map((x) => {
    const price = x.priceAvg || x.price || x.priceFrom;
    const bits = [];
    if (price) bits.push('RM' + Math.round(price).toLocaleString('en') + '/night');
    if (x.hotelName || x.name) bits.push(x.hotelName || x.name);
    if (x.stars) bits.push(x.stars + '★');
    return '  ' + (bits.join('  ·  ') || JSON.stringify(x).slice(0, 90));
  });
  return [where + ', ' + q.checkIn + ' to ' + q.checkOut + '  (in ringgit)', ...lines,
    '  book: ' + hotelSearchLink(q)].join('\n');
}

export const PRICE_TOOL = {
  type: 'custom',
  name: 'check_prices',
  description:
    'What flights and hotels ACTUALLY cost on their dates, right now. Use it before you quote any travel or accommodation price — an average from a blog post is not an answer to "what will it cost me on 14 October". Flights need IATA codes; work them out from the cities. Call it once per route or city rather than per message: these are live lookups, and the answer does not change between two turns of the same conversation.',
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
