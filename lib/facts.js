// The things the agent should never have to guess.
//
// raffy, 2026-09-01: "we can not just give average price but give real time
// price based on date they want to book flight or hotel etc... how can we
// support this agent with tools that they can perform the best for our users"
//
// Prices need a commercial decision (see ROADMAP). Everything in this file did
// not: it is the layer underneath, and it is where most of the invented detail
// in this app actually comes from. The agent has web search and nothing else,
// so "open until 10pm", "about 40 minutes", "September is hot and wet" and
// "roughly RM70" are all written from memory or from a blog post someone wrote
// three years ago. Each one is a tool call away from being true.
//
// Three tools, each batched, because the agent asks these questions in groups:
// several places at once, several legs at once, one set of facts per trip.
//
// Everything here fails out loud. A tool that returns "could not check" makes
// the agent say it could not check; a tool that returns nothing makes the agent
// fall back on memory, which is the exact behaviour being replaced.

import { fetchWith, deadline } from './net.js';
import { lookupPlace, placesKey } from './photos.js';

const T_ONE = 8000;
const T_ALL = 20000;

const ROUTES = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const OM_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const OM_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const HOLIDAYS = 'https://date.nager.at/api/v3/PublicHolidays';
// open.er-api.com rather than the ECB-backed services: the ECB does not publish
// dong, baht or rupiah, so a Da Nang trip — the app's own first trip — would
// have had no rate at all.
const FX = 'https://open.er-api.com/v6/latest/';

const num = (x) => (Number.isFinite(+x) ? +x : null);
const iso = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : null;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// --- what a place is actually like ------------------------------------------

export const PLACE_TOOL = {
  type: 'custom',
  name: 'place_details',
  description:
    'Look up what is actually true about a place right now: its opening hours and closing days, whether it has closed down for good, its price level, phone number, website, rating and coordinates. Use it before you recommend anywhere with a door — a restaurant, a museum, a market, a spa — and before you put an opening time in an itinerary. Batched: ask about several at once. This is the difference between "open until 10pm" and "open until 10pm, and shut on Tuesdays, which is the day you are there".',
  input_schema: {
    type: 'object',
    properties: {
      places: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The place, as precisely as you can: "Madame Lan restaurant".' },
            where: { type: 'string', description: 'City or area, to stop it matching a namesake on another continent.' },
          },
          required: ['name'],
        },
      },
    },
    required: ['places'],
  },
};

export async function placeDetails(places) {
  const list = (places || []).slice(0, 6).filter((p) => p && p.name);
  if (!list.length) return 'No places given.';
  if (!placesKey()) return 'Place lookup is not configured. Say you could not check rather than guessing hours.';

  const found = await Promise.all(list.map(async (p) => {
    try { return { p, d: await lookupPlace([p.name, p.where].filter(Boolean).join(' ')) }; }
    catch (err) { return { p, d: null, err: err.message }; }
  }));

  const lines = [];
  for (const { p, d, err } of found) {
    lines.push('\n' + p.name + (p.where ? ', ' + p.where : ''));
    if (!d) {
      lines.push('  not found' + (err ? ' (' + err + ')' : '') + ' — say so rather than inventing hours');
      continue;
    }
    if (d.name && d.name.toLowerCase() !== p.name.toLowerCase()) lines.push('  matched: ' + d.name);
    if (d.closed) lines.push('  *** PERMANENTLY CLOSED — do not recommend it ***');
    if (d.address) lines.push('  ' + d.address);
    if (d.rating) lines.push('  ' + d.rating);
    if (d.level) lines.push('  price level: ' + d.level);
    if (d.hours && d.hours.length) {
      lines.push('  hours:');
      d.hours.forEach((h) => lines.push('    ' + h));
    } else {
      lines.push('  hours: not published — tell them to check rather than stating one');
    }
    if (d.phone) lines.push('  ' + d.phone);
    if (d.site) lines.push('  ' + d.site);
    if (d.lat != null) lines.push('  at ' + d.lat.toFixed(5) + ',' + d.lon.toFixed(5));
  }
  lines.push('\nHours come from Google and are usually right, but a small place can shut for a wedding. Where a closing day falls on their day there, say it plainly.');
  return lines.join('\n');
}

// --- how long it really takes -----------------------------------------------

export const TRAVEL_TOOL = {
  type: 'custom',
  name: 'travel_time',
  description:
    'How long a journey actually takes, by road, on foot or on public transport. Use it before you write any duration into a plan or a card — "about 40 minutes" is the single most common invented number in a trip, and being wrong by twenty minutes is what turns a good day into a rushed one. Batched: ask about several legs at once.',
  input_schema: {
    type: 'object',
    properties: {
      legs: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Place name, as precisely as you can. Include the city.' },
            to: { type: 'string' },
            mode: { type: 'string', enum: ['drive', 'walk', 'transit'], description: 'Default drive.' },
          },
          required: ['from', 'to'],
        },
      },
      where: {
        type: 'string',
        description: 'The city and country these legs are in, e.g. "Da Nang, Vietnam". Used to disambiguate any place name that does not resolve on its own — "Ancient Town" finds nothing, "Ancient Town, Hoi An, Vietnam" finds it.',
      },
    },
    required: ['legs'],
  },
};

const MODE = { drive: 'DRIVE', walk: 'WALK', transit: 'TRANSIT' };

// Places is strict about bare names: "Hoi An Ancient Town" finds nothing, the
// same string with the country appended finds it. So a miss is retried once
// with the trip's own city rather than reported as a place that does not exist.
async function locate(name, where) {
  const first = await lookupPlace(name).catch(() => null);
  if (first && first.lat != null) return first;
  if (!where) return null;
  const again = await lookupPlace(name + ', ' + where).catch(() => null);
  return again && again.lat != null ? again : null;
}

async function oneLeg(leg, where, budget) {
  const [a, b] = await Promise.all([locate(leg.from, where), locate(leg.to, where)]);
  if (!a) return 'could not find "' + leg.from + '" — give it as "name, city, country"';
  if (!b) return 'could not find "' + leg.to + '" — give it as "name, city, country"';

  const mode = MODE[leg.mode] || 'DRIVE';
  const res = await fetchWith(ROUTES, budget.slice(T_ONE), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': placesKey(),
      'x-goog-fieldmask': 'routes.duration,routes.distanceMeters',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: a.lat, longitude: a.lon } } },
      destination: { location: { latLng: { latitude: b.lat, longitude: b.lon } } },
      travelMode: mode,
      // Live traffic, which is the whole point of asking rather than guessing.
      ...(mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
    }),
  });
  if (!res.ok) {
    // 403 here has one overwhelmingly likely cause and a one-click fix, so say
    // which rather than making somebody read a stack trace. Same shape as the
    // Static Maps key needing its own API switched on.
    const why = res.status === 403
      ? 'routing is not enabled on the Google key (enable the Routes API)'
      : 'routing failed (' + res.status + ')';
    return why + ' — say you have not checked rather than estimating';
  }
  const r = ((await res.json()).routes || [])[0];
  if (!r) return 'no route found — check they are on the same land mass, or say a flight is needed';

  const mins = Math.round(parseInt(String(r.duration || '0'), 10) / 60);
  const km = (num(r.distanceMeters) || 0) / 1000;
  return mins + ' min' + (km ? ', ' + (km < 10 ? km.toFixed(1) : Math.round(km)) + ' km' : '')
    + ' by ' + (leg.mode || 'drive')
    + (mode === 'DRIVE' ? ' (with current traffic)' : '');
}

export async function travelTimes(legs, where) {
  const list = (legs || []).slice(0, 6).filter((l) => l && l.from && l.to);
  if (!list.length) return 'No legs given.';
  if (!placesKey()) return 'Routing is not configured. Do not state a duration you have not checked.';

  const budget = deadline(T_ALL);
  const out = await Promise.all(list.map(async (leg) => {
    try { return leg.from + ' → ' + leg.to + ': ' + (await oneLeg(leg, where, budget)); }
    catch (err) { return leg.from + ' → ' + leg.to + ': failed (' + err.message + ')'; }
  }));
  out.push('\nThese are door to door and include current traffic where it applies. A journey you did not check is a journey you should not put a number on.');
  return out.join('\n');
}

// --- what it is like there, then --------------------------------------------

export const TRIP_FACTS_TOOL = {
  type: 'custom',
  name: 'trip_facts',
  description:
    'The facts that shape a whole trip: what the weather is actually like on those dates, what public holidays fall inside them, and the live exchange rate to ringgit. Call it ONCE, as soon as you know where and when — everything it returns applies to the whole conversation. Public holidays matter more than travellers expect: things close, prices rise, and a city fills up.',
  input_schema: {
    type: 'object',
    properties: {
      place: { type: 'string', description: 'The main destination: "Da Nang, Vietnam".' },
      start: { type: 'string', description: 'YYYY-MM-DD.' },
      end: { type: 'string', description: 'YYYY-MM-DD.' },
      country: { type: 'string', description: 'Two-letter ISO country code, e.g. "VN". For the public holidays.' },
      currency: { type: 'string', description: 'The local currency code, e.g. "VND". For the rate to MYR.' },
    },
    required: ['place', 'start'],
  },
};

// Weather: the forecast if they are close enough for one to exist, otherwise
// what those same dates were actually like in each of the last three years.
// A real observation from last September beats "September is hot and wet",
// and it is honest about being history rather than a prediction.
async function weather(lat, lon, start, end, budget) {
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  const ahead = days(today, start);

  if (ahead <= 16) {
    const q = new URLSearchParams({
      latitude: String(lat), longitude: String(lon), timezone: 'auto',
      start_date: start, end_date: end,
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset',
    });
    const r = await fetchWith(OM_FORECAST + '?' + q, budget.slice(T_ONE));
    if (!r.ok) return ['weather: forecast unavailable'];
    const d = (await r.json()).daily || {};
    out.push('weather (real forecast):');
    (d.time || []).forEach((t, i) => {
      out.push('  ' + t + '  ' + Math.round(d.temperature_2m_min[i]) + '-' + Math.round(d.temperature_2m_max[i])
        + '°C, ' + (d.precipitation_sum[i] || 0).toFixed(1) + 'mm rain'
        + (d.sunrise && d.sunrise[i] ? ', light ' + d.sunrise[i].slice(11) + '–' + d.sunset[i].slice(11) : ''));
    });
    return out;
  }

  // Too far out for a forecast. Three years of the same calendar window.
  const yr = +start.slice(0, 4);
  const spans = [1, 2, 3].map((back) => ({
    year: yr - back,
    a: (yr - back) + start.slice(4),
    b: (yr - back) + (end || start).slice(4),
  }));
  const got = await Promise.all(spans.map(async (s) => {
    try {
      const q = new URLSearchParams({
        latitude: String(lat), longitude: String(lon), timezone: 'auto',
        start_date: s.a, end_date: s.b,
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
      });
      const r = await fetchWith(OM_ARCHIVE + '?' + q, budget.slice(T_ONE));
      if (!r.ok) return null;
      const d = (await r.json()).daily || {};
      const hi = (d.temperature_2m_max || []).filter(Number.isFinite);
      const lo = (d.temperature_2m_min || []).filter(Number.isFinite);
      const rain = (d.precipitation_sum || []).map((x) => x || 0);
      if (!hi.length) return null;
      const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      return {
        year: s.year,
        hi: Math.round(avg(hi)), lo: Math.round(avg(lo)),
        mm: Math.round(rain.reduce((x, y) => x + y, 0)),
        wet: rain.filter((x) => x >= 1).length,
        of: rain.length,
      };
    } catch (err) { return null; }
  }));

  const real = got.filter(Boolean);
  if (!real.length) return ['weather: could not check — do not state what the weather will be like'];
  out.push('weather (what these exact dates were really like, observed):');
  real.forEach((g) => out.push('  ' + g.year + ':  ' + g.lo + '-' + g.hi + '°C, '
    + g.mm + 'mm over ' + g.of + ' days, ' + g.wet + ' of them wet'));
  out.push('  This is history, not a forecast. Say it that way: "last three Septembers were...".');
  return out;
}

async function holidaysIn(country, start, end, budget) {
  const cc = String(country || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return [];
  const years = [...new Set([start.slice(0, 4), (end || start).slice(0, 4)])];
  const hits = [];
  for (const y of years) {
    try {
      const r = await fetchWith(HOLIDAYS + '/' + y + '/' + cc, budget.slice(T_ONE));
      if (!r.ok) continue;
      for (const h of await r.json()) {
        if (h.date >= start && h.date <= (end || start)) {
          hits.push('  ' + h.date + '  ' + (h.localName || h.name) + (h.name !== h.localName ? ' (' + h.name + ')' : ''));
        }
      }
    } catch (err) { /* a missing country is normal, not an error */ }
  }
  return hits.length
    ? ['public holidays while they are there:', ...hits,
       '  Expect closures, higher prices and crowds. Say which of their days it hits.']
    : ['public holidays: none in that window' + (cc ? '' : ' (no country given)')];
}

async function rateTo(currency, budget) {
  const cc = String(currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(cc) || cc === 'MYR') return [];
  try {
    const r = await fetchWith(FX + cc, budget.slice(T_ONE));
    if (!r.ok) return ['exchange rate: could not check'];
    const j = await r.json();
    const myr = num(j && j.rates && j.rates.MYR);
    if (!myr) return ['exchange rate: ' + cc + ' not published'];
    // Both directions: one for reading menus, one for writing prices.
    const per = 1 / myr;
    return ['exchange rate today: 1 ' + cc + ' = RM' + myr.toFixed(myr < 0.01 ? 6 : 4)
      + '  (RM1 = ' + (per >= 1000 ? Math.round(per).toLocaleString('en') : per.toFixed(2)) + ' ' + cc + ')',
      '  Use this to convert every price you quote. It is today\'s rate, so say "about".'];
  } catch (err) { return ['exchange rate: could not check']; }
}

export async function tripFacts(input) {
  const place = String((input && input.place) || '').trim();
  const start = iso(input && input.start);
  const end = iso(input && input.end) || start;
  if (!place || !start) return 'Need a place and a start date as YYYY-MM-DD.';

  const budget = deadline(T_ALL);
  const where = await lookupPlace(place).catch(() => null);

  const [wx, hol, fx] = await Promise.all([
    where && where.lat != null
      ? weather(where.lat, where.lon, start, end, budget).catch(() => ['weather: could not check'])
      : Promise.resolve(['weather: could not locate "' + place + '"']),
    holidaysIn(input.country, start, end, budget).catch(() => []),
    rateTo(input.currency, budget).catch(() => []),
  ]);

  const lines = [place + ', ' + start + (end !== start ? ' to ' + end : '')];
  if (where && where.address) lines.push(where.address);
  lines.push('', ...wx, '', ...hol);
  if (fx.length) lines.push('', ...fx);
  lines.push('', 'Everything above was looked up just now. Anything not in it, you do not know.');
  return lines.join('\n');
}

export const FACT_TOOLS = [PLACE_TOOL, TRAVEL_TOOL, TRIP_FACTS_TOOL];
export const FACT_NAMES = FACT_TOOLS.map((t) => t.name);

export async function answerFactCall(name, input) {
  if (name === 'place_details') return placeDetails((input && input.places) || []);
  if (name === 'travel_time') return travelTimes((input && input.legs) || [], input && input.where);
  if (name === 'trip_facts') return tripFacts(input || {});
  return null;
}

// --- is any of this actually working? ----------------------------------------
//
// Every host above is blocked from the sandbox this app is developed in, so
// none of it could be tested before shipping. That is the same shape as the
// failure that cost this project an evening — Wikimedia and Carto both worked
// from the server and were dead on his phone — except reversed, which is worse,
// because a silent failure here does not look broken. It looks like an agent
// that does not bother to check things.
//
// So the deployment reports on itself: GET /api/health?sources=1.
export async function checkSources() {
  const key = placesKey();
  const ping = async (name, run) => {
    const t = Date.now();
    try {
      const ok = await run();
      return [name, (ok === true ? 'ok' : ok) + ' (' + (Date.now() - t) + 'ms)'];
    } catch (err) {
      return [name, 'FAILED: ' + (err && err.message ? err.message : 'unknown')];
    }
  };

  const checks = await Promise.all([
    ping('places', async () => {
      if (!key) return 'no key';
      const d = await lookupPlace('Furama Resort Danang');
      return d && d.lat != null ? true : 'no result';
    }),
    ping('routes', async () => {
      if (!key) return 'no key';
      const r = await fetchWith(ROUTES, T_ONE, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': key,
          'x-goog-fieldmask': 'routes.duration',
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: 16.03, longitude: 108.25 } } },
          destination: { location: { latLng: { latitude: 15.88, longitude: 108.33 } } },
          travelMode: 'DRIVE',
        }),
      });
      return r.ok ? true : (r.status === 403 ? 'enable the Routes API on the key' : 'HTTP ' + r.status);
    }),
    ping('weather', async () => {
      const r = await fetchWith(OM_FORECAST + '?latitude=16&longitude=108&daily=temperature_2m_max&forecast_days=1', T_ONE);
      return r.ok ? true : 'HTTP ' + r.status;
    }),
    ping('weather history', async () => {
      const y = new Date().getUTCFullYear() - 1;
      const r = await fetchWith(OM_ARCHIVE + '?latitude=16&longitude=108&start_date=' + y + '-09-10&end_date=' + y + '-09-12&daily=temperature_2m_max', T_ONE);
      return r.ok ? true : 'HTTP ' + r.status;
    }),
    ping('holidays', async () => {
      const r = await fetchWith(HOLIDAYS + '/' + new Date().getUTCFullYear() + '/VN', T_ONE);
      return r.ok ? true : 'HTTP ' + r.status;
    }),
    ping('exchange rate', async () => {
      const r = await fetchWith(FX + 'VND', T_ONE);
      if (!r.ok) return 'HTTP ' + r.status;
      const j = await r.json();
      return j && j.rates && j.rates.MYR ? true : 'no MYR rate';
    }),
  ]);

  return Object.fromEntries(checks);
}
