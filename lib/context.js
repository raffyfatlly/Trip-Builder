// Where and when the traveller is.
//
// Two gaps this closes. The agent had no idea what today's date was, so
// "September" could have meant next month or eleven months away, and it could
// not tell whether a trip was urgent. And it did not know where they were
// flying from, which decides the departure airport, the route, the flight
// time and the currency everything should be quoted in.
//
// Neither needs an API. The browser knows its own timezone and clock; Vercel
// puts the request's country and city in headers for free. Both are attached
// to each message so "now" is never stale, and both degrade to nothing when
// unavailable (localhost, a VPN, a browser that blocks it).

import { memoryBlock } from './memory.js';

export const CTX_MARKER = '§CTX§';

// Rough currency by country, so prices can be quoted in something the
// traveller actually uses. Only the ones likely to come up; anything missing
// simply goes unstated rather than guessed.
const CURRENCY = {
  MY: 'MYR (RM)', SG: 'SGD', ID: 'IDR', TH: 'THB', VN: 'VND', PH: 'PHP',
  BN: 'BND', KH: 'KHR', LA: 'LAK', MM: 'MMK', IN: 'INR', LK: 'LKR',
  AU: 'AUD', NZ: 'NZD', JP: 'JPY', KR: 'KRW', CN: 'CNY', HK: 'HKD', TW: 'TWD',
  GB: 'GBP', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR',
  NL: 'EUR', PT: 'EUR', US: 'USD', CA: 'CAD', AE: 'AED', SA: 'SAR', QA: 'QAR',
};

const COUNTRY = {
  MY: 'Malaysia', SG: 'Singapore', ID: 'Indonesia', TH: 'Thailand',
  VN: 'Vietnam', PH: 'Philippines', BN: 'Brunei', IN: 'India',
  AU: 'Australia', NZ: 'New Zealand', JP: 'Japan', KR: 'South Korea',
  CN: 'China', HK: 'Hong Kong', TW: 'Taiwan', GB: 'the UK', US: 'the US',
  CA: 'Canada', AE: 'the UAE', SA: 'Saudi Arabia', QA: 'Qatar',
};

// Vercel sets these on every request. Absent locally, which is fine.
export function geoFrom(req) {
  const h = (n) => {
    const v = req.headers[n];
    return typeof v === 'string' && v.trim() ? decodeURIComponent(v.trim()) : null;
  };
  const country = h('x-vercel-ip-country');
  return {
    country,
    countryName: country ? (COUNTRY[country] || country) : null,
    city: h('x-vercel-ip-city'),
    region: h('x-vercel-ip-country-region'),
    currency: country ? (CURRENCY[country] || null) : null,
    tz: h('x-vercel-ip-timezone'),
  };
}

// One short block, appended to each message. Kept terse because it is sent
// every turn — this is context, not a briefing.
export function contextBlock(geo, client, memory) {
  const now = new Date();
  const tz = (client && client.tz) || (geo && geo.tz) || 'UTC';

  let local;
  try {
    local = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, weekday: 'long', day: 'numeric', month: 'long',
      year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now);
  } catch (e) {
    local = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }

  const bits = [`Right now it is ${local} (${tz}) where the traveller is.`];

  const where = [geo && geo.city, geo && geo.countryName].filter(Boolean).join(', ');
  if (where) bits.push(`They appear to be in ${where}.`);
  if (geo && geo.currency) bits.push(`Local currency there is ${geo.currency}.`);

  bits.push('Use this to resolve vague dates, judge how soon the trip is, work out likely departure airports, and quote prices in a currency they use. It is inferred from their connection, so confirm rather than assume if it matters.');

  // What is already known about them, if anything. Sent every turn like the
  // rest of this block, so a long conversation cannot drift away from it.
  const mem = memoryBlock(memory);
  return CTX_MARKER + ' ' + bits.join(' ') + (mem ? '\n\n' + mem : '');
}
