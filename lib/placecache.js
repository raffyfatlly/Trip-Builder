// One place, looked up once.
//
// raffy, 2026-09-05: "do something about the google services api to drive the
// cost down."
//
// The Chiang Mai trip made 44 billed Places text searches at $0.032 — $1.41,
// against $0.57 to build the entire itinerary. Reading the actual tool inputs,
// they were not 44 places. They were about 25 places asked for more than once,
// in slightly different words, by three different parts of the app:
//
//   place_details  "Wat Phra Singh Chiang Mai"
//   travel_time    "Wat Phra Singh, Chiang Mai"          <- a comma
//   find_photos    "Wat Phra Singh Chiang Mai temple"    <- a trailing noun
//
// Three billed calls, one temple. The old Map cache keyed on the raw string, so
// none of them hit. Two cheap functions fix that, and they are the whole idea
// of this file:
//
//   placeKey()  strips punctuation and case, so the first two collapse.
//   loosely()   also strips a trailing generic noun, so the third does too.
//
// The second is deliberately only used as a fallback and only in one direction:
// a photo search may reuse a full lookup, never the reverse. Asking Google for
// "Wat Phra Singh Chiang Mai" when the builder wanted a temple photo returns
// the temple. Asking for hours and being handed something matched on a looser
// key could hand back the wrong door, and wrong opening hours are the one thing
// this app must not print.

import { readPlace, writePlace, firestoreConfigured } from './firestore.js';

// Lowercase, no punctuation, single spaces. Deliberately NOT reordering or
// deduplicating words: "Chiang Mai Chiang Mai" is a different search from
// "Chiang Mai" as far as Google is concerned, and word order carries meaning.
export const placeKey = (q) =>
  String(q || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    // Vietnamese d-with-stroke is a letter, not a decomposable accent, so NFKD
    // leaves it. Da Nang is in half his trips and "Đà Nẵng" should not be a
    // second billed lookup of the same city.
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

// Words the builder bolts onto the end of a photo search to steer the picture.
// They never change which place is meant, so they never need to change which
// place gets billed for.
const GENERIC = new Set([
  'temple', 'temples', 'hotel', 'hotels', 'resort', 'restaurant', 'cafe', 'coffee',
  'market', 'markets', 'museum', 'palace', 'park', 'garden', 'gardens', 'beach',
  'street', 'road', 'bridge', 'tower', 'island', 'waterfall', 'mountain', 'view',
  'viewpoint', 'shrine', 'church', 'mosque', 'monument', 'building', 'exterior',
  'interior', 'facade', 'photo', 'photos', 'picture', 'city', 'town', 'village',
  'old', 'night', 'walking', 'entrance',
]);

// Countries and the handful of territories that behave like one. These get
// stripped from the END of a key by unqualified(), because place_details asks
// for "Tam Coc Garden Resort Ninh Binh, Vietnam" and find_photos asks for "Tam
// Coc Garden Resort Ninh Binh" — the same hotel, billed twice, seen in the
// Hanoi run on 2026-09-05.
//
// Safe in both directions, unlike the generic nouns below: a trailing country
// never distinguishes two different places, and the four-word floor means
// "Hanoi Vietnam" and "Little Vietnam" are left alone.
const COUNTRY = new Set([
  'vietnam', 'thailand', 'malaysia', 'singapore', 'indonesia', 'cambodia', 'laos',
  'myanmar', 'philippines', 'japan', 'korea', 'china', 'taiwan', 'india', 'nepal',
  'srilanka', 'australia', 'zealand', 'italy', 'france', 'spain', 'portugal',
  'greece', 'turkey', 'germany', 'netherlands', 'switzerland', 'austria', 'croatia',
  'morocco', 'egypt', 'jordan', 'emirates', 'uae', 'qatar', 'kingdom', 'states',
  'usa', 'mexico', 'brazil', 'argentina', 'peru', 'chile', 'canada', 'iceland',
  'norway', 'sweden', 'denmark', 'finland', 'ireland', 'scotland', 'england',
]);

// Drop a trailing country. Used by every caller, both namespaces.
export function unqualified(key) {
  const w = String(key || '').split(' ').filter(Boolean);
  if (w.length < 4) return w.join(' ');
  return COUNTRY.has(w[w.length - 1]) ? w.slice(0, -1).join(' ') : w.join(' ');
}

// Strip ONE trailing generic word, after any country. "wat phra singh chiang
// mai temple" becomes "wat phra singh chiang mai"; "temple street night market"
// becomes "temple street night", which matches nothing and costs one lookup —
// the right outcome, because Temple Street Night Market is a real place in Hong
// Kong and eroding it to "temple street" would have fetched somewhere else.
//
// An earlier version stripped a whole run and did exactly that. One word is
// enough for what the builder actually appends, and cannot eat a name.
//
// Photo searches only. A place matched on a loosened key is fine to take a
// picture of and not fine to read opening hours from.
export function loosely(key) {
  const w = unqualified(key).split(' ').filter(Boolean);
  if (w.length < 4) return unqualified(w.join(' '));
  const cut = GENERIC.has(w[w.length - 1]) ? w.slice(0, -1) : w;
  // Country again: "… chiang mai thailand hotel" needs both off.
  return unqualified(cut.join(' '));
}

// In-process, in front of Firestore. A lambda handling three turns of one
// conversation should not make three network round trips to learn the same
// thing, and this layer costs nothing.
// In-process, in front of Firestore. A lambda handling three turns of one
// conversation should not make three network round trips to learn the same
// thing, and this layer costs nothing.
//
// It holds PROMISES, not values. travel_time resolves both ends of eight legs
// with one Promise.all, so eight lookups for the same hotel start before any of
// them finishes — and a cache that only stores settled answers catches none of
// them. The Hanoi run on 2026-09-05 paid for the airport twice, the Old Quarter
// twice and Tam Coc twice for exactly this reason. Storing the in-flight
// promise means the second caller waits on the first one's request instead of
// starting its own.
const MEM = new Map();
const MEM_MAX = 500;

const remember = (key, promise) => {
  if (MEM.size >= MEM_MAX) MEM.clear();
  MEM.set(key, promise);
  return promise;
};

/**
 * Read-through cache around one billed lookup.
 *
 * `fetch` is only called on a genuine miss, and whatever it returns — including
 * null for "Google does not know this place" — is stored.
 *
 * `ns` namespaces the key. Two callers ask Google different questions about the
 * same words: lookupPlace wants one place with its hours and coordinates,
 * fromGoogle wants a list of photo candidates. Both normalise "Warorot Market
 * Chiang Mai" to the same string, and without a namespace the second would be
 * handed the first one's answer and quietly read an array as if it were a
 * place. They are different shapes and they get different keys.
 *
 * `alsoTry` is one extra key, or several, checked before spending money — read
 * from the namespace given as `alsoTryNs` (the default, unnamespaced one:
 * lookupPlace's). That is how a photo search reuses a lookup the chat already
 * paid for, and how the photo fill finds a place the chat filed under a city
 * name the fill does not know to add.
 *
 * Firestore failures are swallowed on purpose. A cache that can take the app
 * down when it is unavailable is worse than no cache: the fallback is simply
 * paying Google, which is what happened before this file existed.
 */
export function cached(query, fetch, opts = {}) {
  const { ns = '', alsoTry = '', alsoTryNs = '' } = opts;
  const key = placeKey(query);
  if (!key) return Promise.resolve(null);

  const mine = tag(ns, key);
  // alsoTry takes one key or several. The photo search passes one loosened key;
  // the photo fill on a trip that moves passes the same place qualified by each
  // city in turn, because the chat paid for "Dong Xuan Market, Hanoi" and the
  // fill would otherwise buy "Dong Xuan Market" all over again.
  const extra = (Array.isArray(alsoTry) ? alsoTry : [alsoTry])
    .filter(Boolean).map((a) => tag(alsoTryNs, placeKey(a)));
  const keys = [mine, ...extra.filter((k) => k !== mine)];

  for (const k of keys) if (MEM.has(k)) return MEM.get(k);

  // Registered before the first await, so a caller arriving one tick later
  // finds it. Everything expensive happens inside.
  return remember(mine, (async () => {
    if (firestoreConfigured()) {
      for (const k of keys) {
        try {
          const hit = await readPlace(k);
          if (hit) return hit.value;
        } catch (e) { /* fall through and pay for it */ }
      }
    }
    const value = await fetch();
    if (firestoreConfigured()) {
      // Never awaited by a request handler: a cache write is not worth a second
      // of somebody's wait, and losing one costs a nickel next time.
      writePlace(mine, value === undefined ? null : value).catch(() => {});
    }
    return value;
  })().catch((err) => {
    // A failed lookup must not be remembered as "this place does not exist".
    MEM.delete(mine);
    throw err;
  }));
}

// A namespace separator that cannot appear in a normalised key, which is
// letters, digits and single spaces by construction.
const tag = (ns, key) => (ns ? ns + '\u0000' + key : key);

// The photo-candidate namespace. Exported so the one caller and its test agree
// on the spelling rather than both writing the string out.
export const PHOTOS_NS = 'photos';

// For the tests, and for anything that needs a clean slate in one process.
export const _forget = () => MEM.clear();
