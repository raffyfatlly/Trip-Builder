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
import { firecrawlReady } from './firecrawl.js';
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

const nights = (a, b) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86400000) || 1);

// THREE SITES, NOT ONE — and the reason is a wrong answer, not thoroughness.
//
// raffy, 2026-09-07: "everytime it ask for hotel rates now, it says fully
// booked. just give the price range that's find from trusted source. always give
// source! when saying things like booking full or something. cause it might be
// available on other good sites. we are using shitty sites."
//
// He is describing a false negative and he is right about its cause. One page
// was read — Booking.com's search results — and a page that renders empty is
// indistinguishable from a hotel with no rooms. Booking renders empty for
// several reasons that have nothing to do with availability: a property it
// cannot match by name, dates outside the window it publishes, a bot check, a
// region where its inventory is thin. Every one of those came back to the
// traveller as "fully booked", which is a claim about the world made from one
// reseller's page.
//
// So: ask three, in parallel, and let them disagree.
//
//   Booking.com   — widest inventory, and the page the "book it" link opens, so
//                   the number quoted and the page they land on are the same.
//   Agoda         — the one that actually matters here. Raffy's trips are
//                   Southeast Asia (Jakarta, Kuching, Singapore, Da Nang) and
//                   Agoda carries stock in this region that Booking does not,
//                   which is exactly the "available on other good sites" case.
//   Google Hotels — not a reseller. It quotes across sites at once, so it is the
//                   cross-check that catches the other two both being wrong, and
//                   it is the one most likely to give a RANGE rather than a
//                   single number.
//
// Cost: three Firecrawl page reads and three worker calls instead of one. They
// run together, so the wait is unchanged. That is the right trade against
// telling somebody their hotel is full when it is not.
export const HOTEL_SOURCES = ({ hotel, city, checkIn, checkOut, adults = 2 }) => {
  const who = [clean(hotel), clean(city)].filter(Boolean).join(', ');
  const ad = String(Math.max(1, Math.min(9, adults)));
  const los = String(nights(checkIn, checkOut));
  return [
    {
      site: 'Booking.com',
      url: bookingPageFor({ hotel, city, checkIn, checkOut, adults }),
    },
    {
      site: 'Agoda',
      url: 'https://www.agoda.com/search?' + new URLSearchParams({
        textToSearch: who, checkIn, los, adults: ad, rooms: '1',
      }),
    },
    {
      site: 'Google Hotels',
      url: 'https://www.google.com/travel/search?' + new URLSearchParams({
        q: who, checkin: checkIn, checkout: checkOut,
      }),
    },
  ].filter((x) => x.url);
};

// research() returns ONE blob with a "### <question>" heading per question, in
// the order they were asked. Split it back apart so each answer can be labelled
// with the site it came from — attribution is the whole point of this change and
// it is lost the moment the answers are concatenated.
export function bySource(text, sources) {
  const parts = String(text || '').split(/\n?### /).filter(Boolean);
  return sources.map((s, i) => {
    const body = (parts[i] || '')
      .split('\n').slice(1).join('\n').trim();
    const empty = !body || /^(Nothing usable found|Could not research this)/i.test(body);
    return { ...s, body, empty };
  });
}

/**
 * The LockTrip answer, in ringgit, or null if it could not give one.
 *
 * TRIED FIRST, BEFORE ANY PAGE IS READ. raffy, 2026-09-07: "what's our
 * mechanism to find real rates?" It was: fetch Booking's search page and have a
 * model read the rate out of it. Booking served a bot challenge instead, the
 * model truthfully reported no prices, and the agent turned that into
 * "unavailable" — on a hotel that had rooms. An API cannot fail that way. It
 * either answers or says it did not.
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

  // LockTrip quotes in dollars and raffy's travellers think in ringgit, so the
  // conversion happens here, once, and is labelled as ours. Without a rate the
  // figures still go out — in their own currency, named — because a real number
  // in the wrong currency is recoverable and no number is not.
  const fx = await toMyr(r.unit).catch(() => 0);
  const money = (n) => (fx
    ? 'RM' + Math.round(n * fx)
    : r.unit + ' ' + n.toFixed(2));
  const row = (h) => '  ' + [
    h.name,
    h.stars ? h.stars + '★' : '',
    money(h.perNight) + '/night',
    '(' + money(h.total) + ' for the ' + r.nights + ')',
    // Named, because an unattributed score gets attributed: the agent read a
    // bare "6.4/10" off this line and told him it was Booking's.
    h.score ? h.score + '/10 on LockTrip (' + h.reviews + ' reviews)' : '',
    h.refundable ? 'free cancellation' : '',
  ].filter(Boolean).join(' · ');

  const head = (hotel ? hotel + ', ' : '') + where + ', ' + q.checkIn + ' to ' + q.checkOut;
  const out = [head + '  (LockTrip, live, read just now)'];

  // The property they asked about goes first, and when it is not in the
  // inventory we say so rather than showing the cheapest thing nearby. "How
  // much is the Sheraton" answered with four other hotels is not an answer.
  if (hotel && !r.askedFound) {
    out.push('  ' + hotel + ' is NOT in LockTrip\'s inventory for these dates.');
    out.push('  That is not the same as it being full — say only what is true:');
    out.push('  LockTrip does not carry it. Other sites may. Here is the town instead:');
  }
  out.push('  ' + r.total + ' places available in ' + r.place + ' on these dates'
    + (r.low && r.high && r.low.perNight !== r.high.perNight
      ? ', most between ' + money(r.low.perNight) + ' and ' + money(r.high.perNight) + ' a night.'
      : '.'));
  // The outright dearest is kept out of the range and mentioned separately: one
  // mis-keyed whole-property listing turned "RM36 to RM54" into "RM36 to
  // RM9480", which is true of the data and useless to a traveller.
  if (r.max && r.high && r.max.perNight > r.high.perNight * 1.5) {
    out.push('  (A few go far higher — the dearest is ' + money(r.max.perNight)
      + ' a night. Do not put that in the range; it is one listing, usually a whole house.)');
  }
  out.push('');
  out.push(...r.hotels.slice(0, 6).map(row));
  out.push('');
  out.push('  Every figure above is PER NIGHT where it says /night and for the WHOLE '
    + r.nights + '-night stay in brackets. Do not swap them.');
  if (fx) {
    out.push('  LockTrip quotes in ' + r.unit + '; the ringgit is our conversion at today\'s'
      + ' rate, so say "about". Name LockTrip as the source.');
  } else {
    out.push('  In ' + r.unit + ' — the exchange rate could not be checked, so quote the'
      + ' currency as shown and say you could not convert it.');
  }
  out.push('  These are live and they move. Send them to the link for today\'s number.');
  out.push('  book: ' + link);
  return out.join('\n');
}

async function hotelPrices(q) {
  const where = clean(q.city || q.where);
  const hotel = clean(q.hotel);
  const link = hotelSearchLink({ ...q, city: where, hotel });
  if (!where) return 'need a city';
  if (!DATE.test(clean(q.checkIn)) || !DATE.test(clean(q.checkOut))) {
    return 'need checkIn and checkOut as YYYY-MM-DD';
  }

  const head = (hotel ? hotel + ', ' : '') + where + ', ' + q.checkIn + ' to ' + q.checkOut;
  const nogo = (why) => [head, '  ' + why,
    '  Say that plainly. Do NOT estimate a rate and do NOT go and find one by web search:',
    '  a number off a blog or an aggregator page is not what it will cost them, and putting',
    '  it on a card as the price is worse than saying you do not know.',
    '  book: ' + (link || 'no link — give me the city, not the hotel name')].join('\n');

  // LockTrip first: free, keyless, and it cannot mistake a bot challenge for an
  // empty hotel. The page-reading below is the fallback for when it is rate
  // limited (5 searches a minute per IP) or does not carry the town.
  const live = await fromLocktrip(q, link || '').catch(() => null);
  if (live) return live;

  // No reader, no rate. Both halves are needed: Firecrawl fetches the page and
  // the worker reads it, and either being unconfigured means there is no path
  // to a number at all.
  if (!firecrawlReady() || !(await researchReady())) {
    return nogo('no live rate available — there is no hotel price service configured.');
  }

  const sources = HOTEL_SOURCES({ hotel, city: where, checkIn: q.checkIn, checkOut: q.checkOut, adults: q.adults });
  if (!sources.length) return nogo('could not build a page to read for those dates.');

  const n = nights(q.checkIn, q.checkOut);
  const stay = n + (n === 1 ? ' night' : ' nights');
  const subject = hotel
    ? hotel + ' in ' + where
    : 'hotels in ' + where;

  const out = await research(sources.map(({ site, url }) => ({
    url,
    about: 'rates on ' + site,
    // The site name leads the question because research() titles each answer
    // with the question text — that heading is how the answer gets attributed
    // below, and an unattributed rate is the thing being fixed here.
    q: 'On ' + site + ': what does ' + subject + ' cost for ' + stay + ', '
      + q.checkIn + ' to ' + q.checkOut + '?'
      + ' Read ONLY this page. Report prices only if the page actually shows them for'
      + ' these exact dates; if it shows a price for other dates, say which dates.'
      + ' Give the CHEAPEST and the DEAREST nightly rate visible as a range, then name'
      + ' up to three properties with their own rates'
      + (hotel ? ', and put ' + hotel + ' first if it is there' : '') + '.'
      + ' State for each figure whether it is PER NIGHT or for the WHOLE STAY — the page'
      + ' is not consistent, and quoting a whole-stay total as a nightly rate makes a trip'
      + ' look several times more expensive than it is. Give the currency exactly as shown.'
      + ' If the page shows no rooms or no prices at all, say exactly that and say nothing'
      + ' more — do not conclude the hotel is full, and do not estimate, average or infer'
      + ' anything the page does not state.',
  }))).catch(() => null);

  const read = bySource((out && out.text) || '', sources);
  return hotelAnswer({ head, stay, read, link: link || sources[0].url });
}

/**
 * The answer the agent reads, given what each site said. Pure, so the two
 * branches that matter can be tested without spending a Firecrawl credit.
 */
export function hotelAnswer({ head, stay, read, link, at = new Date() }) {
  const got = read.filter((r) => !r.empty);
  const when = at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const names = read.map((r) => r.site).join(', ');

  // NOTHING ANYWHERE IS STILL NOT "FULLY BOOKED".
  //
  // This is the branch that produced the wrong answer. Three empty pages are
  // evidence about three pages. The instruction is spelled out because the agent
  // will otherwise compress "no rates found" into "it is fully booked", which is
  // a different and much stronger claim — and the one raffy kept being told.
  if (!got.length) {
    return [head,
      '  None of these published a rate for those dates when read at ' + when + ': ' + names + '.',
      '  DO NOT SAY IT IS FULLY BOOKED OR SOLD OUT. You did not check the hotel; you checked',
      '  ' + read.length + ' resellers, and an empty page means the site had nothing to show —',
      '  a name it could not match, dates outside what it publishes, or thin stock in that',
      '  region. Say which sites you looked at, when, and that they showed nothing, then send',
      '  them to the link. Do NOT estimate a rate and do NOT go and find one by web search.',
      '  book: ' + link].join('\n');
  }

  return [head + '  (' + stay + ', read at ' + when + ' — published rates, not a live quote)',
    ...read.flatMap((r) => (r.empty
      ? ['  ' + r.site + ': showed no rate for these dates.']
      : ['  ' + r.site + ':', ...r.body.split('\n').map((l) => '    ' + l)])),
    '  ',
    '  ALWAYS NAME THE SITE AND WHEN IT WAS READ when you pass any of this on — "Agoda had',
    '  it at RM320 a night when I looked just now", never a bare number. Where the sites',
    '  disagree, give the range across them rather than picking one, and say so: that spread',
    '  is real and it is useful. If one showed nothing and another showed rooms, the rooms',
    '  are the answer — never call a place full because one site was empty.',
    '  Rooms sell and prices move; send them to the link for today\'s number.',
    '  book: ' + link].join('\n');
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
        description: 'Hotel rates come from LockTrip, a live inventory of 2.5M properties,'
          + ' with three booking pages (Booking.com, Agoda, Google Hotels) read as a fallback'
          + ' when it cannot answer. Ten to twenty seconds: ask for it when you want a number,'
          + ' not speculatively.'
          + ' ALWAYS NAME THE SITE AND THE TIME when you pass a rate on — "Agoda had it at'
          + ' RM320 a night when I looked just now", never a bare number. Where the three'
          + ' disagree, give the RANGE across them and say they disagree; that spread is'
          + ' real and useful. NEVER SAY A PLACE IS FULLY BOOKED OR SOLD OUT on the strength'
          + ' of this. A site showing nothing means that site had nothing to show — a name'
          + ' it could not match, dates outside what it publishes, thin stock in that region'
          + ' — and another site may well have rooms. Say which sites you checked, when, and'
          + ' what each one showed. Never estimate a rate yourself and never go and find one'
          + ' by web search: a number off a blog or an aggregator is not what it will cost'
          + ' them, and putting it on a card is worse than saying you do not know. Read'
          + ' whether each figure is PER NIGHT or for the WHOLE STAY and repeat it that way'
          + ' — quoting a stay total as a nightly rate makes a trip look several times more'
          + ' expensive than it is.',
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
