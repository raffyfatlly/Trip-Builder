// What a shared trip says about itself when the link is pasted somewhere.
//
// raffy, 2026-09-16: "every trip someone shares silently advertises the app
// before anyone clicks... something that intrigues people to open the link."
//
// The picture is drawn by /api/og. This is the half that decides what goes on
// it, and it lives here rather than in pages/t/[s].js because every line of it
// is a judgement about what makes somebody tap — which is worth being able to
// test against a real itinerary rather than by pasting links into WhatsApp.

import { sign } from './ogsign.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "13–20 November", or "28 Nov – 3 Dec" when it straddles two months.
 *
 * Read off the ISO strings by hand rather than through Date, which shifts the
 * day by a timezone and would put a trip that starts on the 1st in the
 * previous month for anybody west of London.
 */
export function when(start, end) {
  const a = ISO.exec(String(start || ''));
  if (!a || !MONTHS[+a[2] - 1]) return '';
  const d1 = +a[3];
  const m1 = +a[2] - 1;
  const b = ISO.exec(String(end || ''));
  if (!b || !MONTHS[+b[2] - 1]) return d1 + ' ' + MONTHS[m1];
  const d2 = +b[3];
  const m2 = +b[2] - 1;
  if (m1 === m2 && a[1] === b[1]) return d1 + '–' + d2 + ' ' + MONTHS[m1];
  return d1 + ' ' + MONTHS[m1].slice(0, 3) + ' – ' + d2 + ' ' + MONTHS[m2].slice(0, 3);
}

export const count = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/** "8 days · 13–20 November · 4 stays" — the grounding line. */
export function facts(it) {
  const t = (it && it.trip) || {};
  return [
    count(((it && it.days) || []).length, 'day', 'days'),
    when(t.start, t.end),
    ((it && it.stays) || []).length ? count(it.stays.length, 'stay', 'stays') : '',
  ].filter(Boolean).join(' · ');
}

// Getting there is not the trip. Every itinerary opens with the flight and
// closes with the checkout, so a teaser that reads the days in order leads
// with "Depart KLIA for Naples · Land in Naples" — which is what the first
// real card built by this code actually said, for a week on the Amalfi coast.
const CHORE = /^(depart|arrive|arrival|land|fly|flight|check[\s-]?in|check[\s-]?out|transfer|collect|pick up|drop off|pack|board|return to|head (to|back)|travel to|make your way)\b/i;

// Three names and a little over half the line; the rest is for the count.
const NAME = 34;
const LINE = 60;

// The place a heading is about, near enough: the capitalised words in it.
// Used only to notice that two headings are about the same one.
const nouns = (h) => new Set(
  (h.match(/\b[A-Z][A-Za-zà-öø-ÿ'’-]{2,}/g) || []).map((w) => w.toLowerCase()),
);

/**
 * THE LINE THAT MAKES SOMEBODY TAP.
 *
 * Three things that are actually in the plan, then how many more there are.
 * The count is the point: "+34 more" is a question only opening the link
 * answers, and unlike a slogan it is true.
 *
 * Which three is the whole craft. An item carries a photo when it names a real
 * place — that is what the builder is told, in so many words, and it is a far
 * better signal than anything this file could infer from the words. So: the
 * anchor moments at real places first, then real places, then whatever is
 * left, with the logistics thrown out at every tier.
 */
export function teaser(it) {
  const items = (((it && it.days) || []).flatMap((d) => (d && d.items) || []))
    .filter((x) => x && typeof x.h === 'string' && x.h.trim());
  const worth = (x) => !CHORE.test(x.h.trim());
  const tiers = [
    items.filter((x) => x.major && x.photo && worth(x)),
    items.filter((x) => x.photo && worth(x)),
    // A trip whose photo round failed still has its anchors marked, and they
    // are still the best three things in it.
    items.filter((x) => x.major && worth(x)),
    items.filter(worth),
    items,
  ];

  const picked = [];
  const named = new Set();
  let used = 0;
  for (const tier of tiers) {
    // Shortest first within a tier. The same place tends to appear as both the
    // thing and the journey to it — "Pompeii ruins" and "Circumvesuviana to
    // Pompeii" — and the shorter one is the one somebody wants to read.
    for (const x of [...tier].sort((a, b) => a.h.trim().length - b.h.trim().length)) {
      if (picked.length >= 3) break;
      const h = x.h.trim();
      // Budgeted rather than capped per name, so one evocative heading and one
      // short one beats three clipped ones.
      if (h.length > NAME || picked.includes(h)) continue;
      if (used && used + 3 + h.length > LINE) continue;
      // Three slots, three places. Naming Pompeii twice spends a third of the
      // line saying nothing new.
      const words = nouns(h);
      if ([...words].some((w) => named.has(w))) continue;
      picked.push(h);
      for (const w of words) named.add(w);
      used += (used ? 3 : 0) + h.length;
    }
  }
  if (!picked.length) return '';
  const rest = items.length - picked.length;
  return picked.join(' · ') + (rest > 0 ? ' · +' + rest + ' more' : '');
}

/**
 * The cover, in the shape /api/og is allowed to fetch.
 *
 * A Places photo goes back to being a bare reference, because the card
 * resolves those through /api/photo the way the rest of the app does. Anything
 * else travels as its own https URL and is signed by shareCard below.
 *
 * The hero first — the picture the trip already leads with — and any photo it
 * has otherwise, because a card with the wrong good photograph still beats a
 * card with none.
 */
export function cover(it) {
  const photos = (it && it.photos) || {};
  const feature = it && it.trip && it.trip.feature && it.trip.feature.photo;
  const key = (feature && photos[feature]) ? feature : Object.keys(photos)[0];
  const url = key ? String(photos[key] || '') : '';
  if (!url) return '';
  const ref = /^\/api\/photo\?.*\bref=([^&]+)/.exec(url);
  if (ref) {
    try { return decodeURIComponent(ref[1]); } catch (err) { return ''; }
  }
  return url.startsWith('https://') ? url : '';
}

const cardUrl = (base, q) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, String(v));
  return base + '/api/og?' + p.toString();
};

/** Everything the <head> needs for a trip that exists. */
export async function shareCard(it, base, url) {
  const title = (it && it.trip && it.trip.title) || 'Trip';
  const f = facts(it);
  const h = teaser(it);
  const p = cover(it);
  // A Places reference proves itself by its shape; anything else — the hotel's
  // own photograph, most usefully — travels with a tag only this deployment
  // can mint, so the card can use any hero without /api/og becoming a proxy
  // for the whole internet. See lib/ogsign.js.
  const k = p && p.startsWith('https://') ? await sign(p) : '';
  return {
    title,
    // The card's own two lines, joined: a client that shows text instead of
    // the image should still get the places that make somebody tap.
    description: h ? f + ' — ' + h : f,
    url,
    image: cardUrl(base, { t: title, f, h, p, k }),
  };
}

/**
 * And for a trip that does not exist yet.
 *
 * Sharing early is not a mistake to be punished with a dead preview — it is
 * somebody excited enough to send the link before the thing finished. The card
 * names the place if the conversation has settled on one and says plainly that
 * the itinerary is coming to this same URL.
 */
export function planningCard(plan, base, url) {
  const where = String((plan && plan.destination) || '').split(',')[0].trim();
  return {
    title: where || 'A trip in the making',
    description: where
      ? 'Being planned right now. The itinerary lands on this same link.'
      : 'A trip being planned in Trip Builder.',
    url,
    image: cardUrl(base, {
      t: where,
      s: 'planning',
      f: (plan && plan.dates) || '',
      h: 'The itinerary is being put together right now',
    }),
  };
}
