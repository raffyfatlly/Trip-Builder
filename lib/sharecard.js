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

/**
 * THE LINE THAT MAKES SOMEBODY TAP.
 *
 * Three things that are actually in the plan, then how many more there are.
 * The count is the point: "+21 more" is a question only opening the link
 * answers, and unlike a slogan it is true.
 *
 * Short headings first, and the ones the builder marked major before those.
 * "Hagia Sophia" sells the trip; "Check out of Schloss Lieser and drive back
 * to Idstein" fills the card with a chore.
 */
export function teaser(it) {
  const items = (((it && it.days) || []).flatMap((d) => (d && d.items) || []))
    .filter((x) => x && typeof x.h === 'string' && x.h.trim());
  const short = (x) => x.h.trim().length <= 30;
  const picked = [];
  const take = (list) => {
    for (const x of list) {
      if (picked.length >= 3) return;
      const h = x.h.trim();
      if (!picked.includes(h)) picked.push(h);
    }
  };
  take(items.filter((x) => x.major && short(x)));
  take(items.filter(short));
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
