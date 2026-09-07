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

  bits.push('Use this to resolve vague dates, judge how soon the trip is, and work out likely departure airports. It is inferred from their connection, so confirm rather than assume if it matters. Prices are a separate matter: quote every one in RM regardless of where they are or where they are going.');

  // What is already known about them, if anything. Sent every turn like the
  // rest of this block, so a long conversation cannot drift away from it.
  const mem = memoryBlock(memory);
  return CTX_MARKER + ' ' + bits.join(' ') + (mem ? '\n\n' + mem : '');
}

// WHO IS SPEAKING, on a shared trip — told to the agent, not written into the
// message.
//
// raffy, 2026-09-07, looking at a chat he shares with Syahirah: "its weird to
// see the chats. i said something to syahirah. it got quoted. but I still have
// the original text accumulating at the bottom."
//
// The speaker used to be prefixed onto the message itself — "raffy.fatlly:
// something new" — which put the name in the one place it could do damage. The
// browser drops an optimistic bubble the moment you press send and clears it
// when the same text comes back from the server; with a name glued to the
// front it never matched, so every message he sent stayed on screen forever
// while the server's copy appeared above it. Two of everything, and the pile
// grew with each turn.
//
// So the name travels in its own marked block. The agent reads it, the display
// layer strips it (see display()), and the text of a message is the text they
// typed — which is what the optimistic bubble is compared against.
export const FROM_MARKER = CTX_MARKER + 'from:';

export const fromBlock = (who) =>
  FROM_MARKER + who + '\nThat is who this message is from. Several people share'
  + ' this trip; answer the one who just spoke, and use their name when it helps.';

/** Read the speaker back out of a message's content, for display. */
export function whoIn(content) {
  for (const c of content || []) {
    if (c && c.type === 'text' && String(c.text || '').startsWith(FROM_MARKER)) {
      return String(c.text).slice(FROM_MARKER.length).split('\n')[0].trim();
    }
  }
  return '';
}
