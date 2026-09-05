// Finding photos, server-side.
//
// Two problems, and they are different.
//
// The first was mechanical: the builder was told to fetch the Wikimedia
// Commons API itself, but Managed Agents' web_fetch only retrieves URLs that
// already appear in the conversation, so a URL the model assembles is refused
// with url_not_accessible. Every attempt failed and itineraries shipped with no
// pictures. That is why the lookup happens here instead.
//
// The second is the one that actually matters: Commons rarely has a photo of
// *this hotel*. It has the beach, the bridge, the national park. So the search
// now also covers Openverse, which indexes Flickr and friends and is far
// better on specific places, and a direct URL can be passed straight through —
// (raffy, 2026-08-31: "usually i just google image right and use that photo").
//
// Restricting the host was never what kept pictures from breaking. CHECKING
// THEM IS. Every URL here is fetched before it is offered, so what comes back
// is known to load, whoever is serving it.

import { fetchWith, deadline } from './net.js';
import { cached, placeKey, loosely, unqualified, PHOTOS_NS } from './placecache.js';

// How long any one lookup may take. A photo is a nice-to-have; the itinerary
// is not. Nothing here is worth making someone wait.
const T_PAGE = 6000;      // somebody else's website, the least trustworthy
const T_IMG = 6000;       // checking an image actually loads
const T_API = 8000;       // Commons, Openverse, Places
const T_ALL = 25000;      // the whole find_photos call, however many queries

// A map of the exact spot, when there is genuinely no photograph of it. Free,
// no key, and honest in a way a stock picture of "a beach" is not — this
// really is where they are staying. (raffy, 2026-08-31: "if no photo at least
// the google link or something. image as placeholder is good".)
export const mapFor = (lat, lon, zoom = 15) =>
  (Number.isFinite(+lat) && Number.isFinite(+lon))
    ? `https://maps.wikimedia.org/img/osm-intl,${zoom},${(+lat).toFixed(4)},${(+lon).toFixed(4)},640x360.png`
    : null;

// Somewhere to go and look, for anything we could not picture.
export const lookupLink = (name, where) =>
  'https://www.google.com/maps/search/' + encodeURIComponent([name, where].filter(Boolean).join(' '));

// Google's own photo of the place, which is the picture everybody actually
// means. (raffy, 2026-08-31 and again 2026-09-01: "just create a tool that can
// somehow download image you can find in google?")
//
// There is no free Google *Images* API, and scraping the results page breaks
// constantly and is against their terms — but Places has the same photographs,
// served properly: search the hotel by name, take the first photo it holds.
// This is the source that finally gets the right building, and it carries the
// rating too, which is what the whole app is supposed to recommend on.
//
// Off unless GOOGLE_PLACES_API_KEY is set, and everything below still works
// without it. The key never leaves the server: photo URLs point at our own
// /api/photo, which fetches the bytes with the key and streams them back.
const PLACES = 'https://places.googleapis.com/v1/';
export const placesKey = () =>
  process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';

// The proxy URL for one photo ref.
//
// Deliberately NOT tagged with the session that minted it. That was tried on
// 2026-09-04 and is wrong twice over: place lookups are cached, so the second
// session to want the same hotel gets the first session's URL and pays its
// bill; and a URL baked into an itinerary outlives the session entirely, so
// every later view of a shared trip bills somebody who stopped planning weeks
// ago. Misattributed money is worse than unattributed money.
//
// So this stays clean and shareable, one CDN entry per photo for everyone, and
// the cost of serving it goes to the house ledger in lib/meter.js. The
// per-trip photo cost is still attributed properly, because /api/bake fetches
// every photo inside the session that asked to bake it.
export const photoProxy = (ref) => '/api/photo?ref=' + encodeURIComponent(ref);

// What /api/photo will accept. Anything else is somebody probing.
export const PHOTO_REF = /^places\/[A-Za-z0-9_-]{4,128}\/photos\/[A-Za-z0-9_-]{4,512}$/;

export const photoMediaUrl = (ref, width = 1200) =>
  PLACES + ref + '/media?maxWidthPx=' + width + '&key=' + encodeURIComponent(placesKey());

const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const OPENVERSE = 'https://api.openverse.org/v1/images/';

const IMAGE_EXT = /\.(jpe?g|png|webp|avif)$/i;
const UA = 'TripBuilder/1.0 (personal itinerary app)';

const plain = (s) =>
  String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const httpsImage = (u) => {
  if (typeof u !== 'string' || !/^https:\/\//i.test(u)) return false;
  try { new URL(u); } catch (e) { return false; }
  return true;
};

// Does this URL actually serve an image right now?
//
// A HEAD is enough for most hosts. Some answer 405 to HEAD but serve a GET
// fine, so fall back to a ranged GET rather than discarding a good photo. A
// URL that fails both is dropped — a broken picture is worse than no picture,
// and the app has a designed empty state for the second.
async function loads(url) {
  const check = async (method, extra) => {
    const res = await fetchWith(url, T_IMG, {
      method,
      redirect: 'follow',
      headers: { 'user-agent': UA, ...(extra || {}) },
    });
    const type = res.headers.get('content-type') || '';
    return { ok: res.ok && /^image\//i.test(type), type };
  };
  try {
    const head = await check('HEAD');
    if (head.ok) return true;
    const get = await check('GET', { range: 'bytes=0-2047' });
    return get.ok;
  } catch (e) {
    return false;
  }
}

export const FIND_TOOL = {
  type: 'custom',
  name: 'find_photos',
  description:
    "Find real, working photo URLs. Give it a `search` with the place's exact name and it looks through Google Places — which holds the actual photograph of that hotel or restaurant, and its rating — then Wikimedia Commons and Openverse, which are good for landmarks and beaches. Give it a `page` (the place's own website) to take that site's own main photo instead. Give it a `url` for an image address the traveller handed you. Pass a page AND a search together and the page wins, falling back to the search. Every result is fetched and checked before you see it. You still judge whether it is genuinely the place you wanted.",
  input_schema: {
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        description: 'Up to 8 in one call.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'The photo key you will use in the itinerary, e.g. "dragonbridge".' },
            search: { type: 'string', description: 'What to search for, e.g. "Dragon Bridge Da Nang". Leave out if you are passing a url or a page.' },
            url: { type: 'string', description: 'A direct image URL the traveller gave you, to check and use as-is.' },
            page: { type: 'string', description: "The place's own website — the hotel's homepage, the restaurant's site. Its own main photo is pulled from the page. This is the best way to get a picture of a specific hotel, which searches almost never have." },
          },
          required: ['key'],
        },
      },
    },
    required: ['queries'],
  },
};

// The picture a hotel puts on its own website.
//
// This is the honest version of "just get it off Google". There is no free
// image search API, and scraping results would break constantly and is against
// their terms — but a hotel's own og:image is the same photograph, served by
// the people who want it seen, and it is one fetch away.
async function fromPage(pageUrl) {
  const res = await fetchWith(pageUrl, T_PAGE, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('page ' + res.status);
  // Only the head is needed, and a hotel homepage can be megabytes.
  const html = (await res.text()).slice(0, 300000);

  const grab = (prop) => {
    const re = new RegExp(
      '<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*>', 'i');
    const tag = (html.match(re) || [])[0];
    return tag ? (tag.match(/content=["']([^"']+)["']/i) || [])[1] : null;
  };

  const raw = grab('og:image') || grab('og:image:url') || grab('twitter:image');
  if (!raw) return [];
  let url;
  try { url = new URL(raw, pageUrl).toString(); } catch (e) { return []; }
  if (!httpsImage(url)) return [];

  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1];
  return [{
    title: plain(title).slice(0, 90) || 'From their own site',
    url,
    description: 'The photo this place puts on its own website.',
    licence: "the venue's own image",
    artist: '',
    via: new URL(pageUrl).hostname.replace(/^www\./, ''),
  }];
}

// The builder's photo search. Cached on the same keys as lookupPlace, and
// allowed to reuse a lookup the chat already paid for: find_photos asks for
// "Wat Phra Singh Chiang Mai temple" minutes after place_details asked for
// "Wat Phra Singh Chiang Mai", and that trailing noun was costing $0.032 a
// time for a picture of a place already in the cache.
//
// Only in this direction. A lookup matched on the looser key comes back here
// as a photo, which is harmless if it is slightly off; the reverse would put a
// loosely-matched restaurant's opening hours on a card, which is not.
async function fromGoogle(search, limit) {
  const key = placesKey();
  if (!key) return [];
  const loose = loosely(placeKey(search));
  const hit = await cached(search, () => fromGoogleNow(search, limit), { ns: PHOTOS_NS, alsoTry: loose });
  if (Array.isArray(hit)) return hit;
  // A cached full lookup rather than a cached photo search: one place, with a
  // photo on it if it had one. Shaped to match what this function returns.
  if (hit && hit.photo) {
    return [{
      title: (hit.name || search).slice(0, 90),
      url: hit.photo,
      description: hit.address || '',
      licence: 'Google Places',
      artist: '',
      via: 'Google',
      rating: hit.rating || '',
    }];
  }
  return [];
}

async function fromGoogleNow(search, limit) {
  const key = placesKey();
  if (!key) return [];
  const res = await fetchWith(PLACES + 'places:searchText', T_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': key,
      // Ask for exactly what is used. Places bills by field mask, so a lazy
      // mask here is a bill later.
      'x-goog-fieldmask':
        'places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.photos',
      'user-agent': UA,
    },
    body: JSON.stringify({ textQuery: search, pageSize: Math.min(limit, 5) }),
  });
  if (!res.ok) throw new Error('places ' + res.status);
  const data = await res.json();

  const out = [];
  for (const p of (data && data.places) || []) {
    const ref = ((p.photos || [])[0] || {}).name;
    if (!ref || !PHOTO_REF.test(ref)) continue;
    const rating = Number.isFinite(p.rating)
      ? p.rating + '\u2605' + (p.userRatingCount ? ' from ' + p.userRatingCount + ' reviews' : '')
      : '';
    out.push({
      title: plain((p.displayName && p.displayName.text) || search).slice(0, 90),
      // Proxied, so the key stays here and the itinerary can be shared.
      url: photoProxy(ref),
      absolute: photoMediaUrl(ref),
      description: [plain(p.formattedAddress).slice(0, 120), rating].filter(Boolean).join(' \u00b7 '),
      licence: 'Google Places',
      artist: '',
      via: 'Google',
    });
    if (out.length >= limit) break;
  }

  // Deliberately NOT fetched to check, unlike every other source here.
  //
  // Place Photos bills per request to the media endpoint. Verifying three
  // candidates to use one meant paying for three photos a place and throwing
  // two away — and the check proves nothing anyway: this reference came back
  // from Google's own API moments ago, in the same breath as the place. If one
  // ever does fail to load, the app already handles it; a broken image falls
  // back to a map of the same hotel.
  for (const h of out) { delete h.absolute; h.checked = true; }
  return out;
}

async function fromCommons(search, limit) {
  const url = COMMONS + '?' + new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: search,
    gsrnamespace: '6', gsrlimit: String(limit),
    prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1200',
    format: 'json', origin: '*',
  });
  const res = await fetchWith(url, T_API, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error('commons ' + res.status);
  const data = await res.json();
  const pages = (data && data.query && data.query.pages) || {};
  return Object.keys(pages).map((id) => {
    const p = pages[id] || {};
    const info = (p.imageinfo || [])[0] || {};
    const meta = info.extmetadata || {};
    const src = IMAGE_EXT.test(String(info.thumburl || '').split('?')[0]) ? info.thumburl : info.url;
    return {
      title: plain(p.title).replace(/^File:/, ''),
      url: src,
      description: plain(meta.ImageDescription && meta.ImageDescription.value).slice(0, 200),
      licence: plain(meta.LicenseShortName && meta.LicenseShortName.value) || 'see Commons',
      artist: plain(meta.Artist && meta.Artist.value).slice(0, 60),
      via: 'Commons',
    };
  }).filter((h) => httpsImage(h.url));
}

// Openverse indexes Flickr and others, so it has the specific hotel, the
// specific restaurant, the street — the things Commons does not.
async function fromOpenverse(search, limit) {
  const url = OPENVERSE + '?' + new URLSearchParams({
    q: search, page_size: String(limit), mature: 'false',
  });
  const res = await fetchWith(url, T_API, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error('openverse ' + res.status);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    title: plain(r.title).slice(0, 90),
    url: r.url,
    description: plain(r.tags && r.tags.map((t) => t.name).join(', ')).slice(0, 160),
    licence: (r.license ? String(r.license).toUpperCase() : '') + (r.license_version ? ' ' + r.license_version : '') || 'see Openverse',
    artist: plain(r.creator).slice(0, 60),
    via: 'Openverse',
  })).filter((h) => httpsImage(h.url));
}

// Everything both sources offered, checked, best-first, deduped by URL.
async function candidates(search) {
  // Google first: it is the only one of the three that reliably has *this*
  // hotel rather than the beach it sits on.
  // Only sources that can actually run. Google with no key is not a source
  // that failed, it is one that was never asked, and counting it as a success
  // hid the case below for weeks.
  const sources = [
    ...(placesKey() ? [fromGoogle(search, 3)] : []),
    fromCommons(search, 4),
    fromOpenverse(search, 4),
  ];
  const settled = await Promise.allSettled(sources);
  const seen = new Set();
  const all = [];
  // Interleave so one source cannot crowd the other out of the shortlist.
  const lists = settled.map((r) => (r.status === 'fulfilled' ? r.value : []));
  // Every source erroring is not the same fact as every source finding nothing,
  // and until now both came back as "nothing usable found — leave this one
  // without a photo". The builder then wrote the trip off as unphotographable
  // when Places was simply down. Say which it was.
  if (settled.every((r) => r.status === 'rejected')) {
    const why = settled.map((r) => (r.reason && r.reason.message) || 'unknown');
    throw new Error('every photo source failed (' + why.join('; ').slice(0, 160) + ')');
  }
  for (let i = 0; i < 4; i++) {
    for (const list of lists) {
      const h = list[i];
      if (!h || seen.has(h.url)) continue;
      seen.add(h.url);
      all.push(h);
    }
  }
  const checked = await Promise.all(
    all.map(async (h) => (h.checked || (await loads(h.url)) ? h : null)));
  const live = checked.filter(Boolean).slice(0, 3);
  if (!live.length && settled.every((r) => r.status === 'rejected')) {
    throw new Error(settled.map((r) => r.reason && r.reason.message).join('; '));
  }
  return live;
}

async function resolveOne(q) {
  // A URL the traveller handed over wins outright. It is the one case where
  // somebody has actually looked at the picture.
  if (q.url) {
    if (!httpsImage(q.url)) return { hits: [], note: 'that is not an https image URL' };
    if (!(await loads(q.url))) return { hits: [], note: 'that URL did not return an image — ask them for another' };
    return { hits: [{ title: 'Supplied by the traveller', url: q.url, description: '', licence: 'supplied', artist: '', via: 'traveller' }] };
  }
  // A page beats a search for anything specific: the hotel's own photograph of
  // itself is better than the best guess a stock library can offer.
  if (q.page) {
    try {
      const hits = await fromPage(q.page);
      const live = [];
      for (const h of hits) if (await loads(h.url)) live.push(h);
      if (live.length) return { hits: live };
      if (!q.search) return { hits: [], note: 'that page has no usable main image' };
    } catch (err) {
      if (!q.search) return { hits: [], note: 'could not read that page: ' + err.message };
    }
  }

  if (!q.search) return { hits: [], note: 'no search terms, page or url' };
  try {
    return { hits: await candidates(q.search) };
  } catch (err) {
    return { hits: [], note: 'lookup failed: ' + err.message };
  }
}

// Returns text for the agent: candidates per key, or an honest note that
// nothing usable was found. Never invents a URL to fill a gap.
export async function findPhotos(queries) {
  const list = (queries || []).slice(0, 8);
  if (!list.length) return 'No queries given.';

  // One budget for the whole call. Eight queries running in parallel each have
  // their own per-fetch timeouts, but this is the hard ceiling: whatever has
  // come back when it expires is what the agent gets. A partly-illustrated
  // itinerary beats a request that never returns.
  const budget = deadline(T_ALL);
  const results = await Promise.all(list.map(async (q) => {
    try {
      return { q, ...(await resolveOne(q)) };
    } catch (err) {
      return { q, hits: [], note: 'lookup failed: ' + (err && err.message ? err.message : 'unknown') };
    }
  }));
  if (budget.spent()) {
    // Worth saying out loud: silence here reads as "there are no photos of
    // this place", which is a different and wrong conclusion.
    results.push({ q: { key: '(note)' }, hits: [], note: 'the photo budget ran out — some lookups were cut short, try fewer at a time' });
  }

  const lines = [];
  for (const { q, hits, note } of results) {
    lines.push('\n' + q.key + (q.url ? '  (their own URL)' : '  (searched: ' + q.search + ')'));
    if (!hits.length) {
      lines.push('  ' + (note || 'nothing usable found — leave this one without a photo'));
      continue;
    }
    hits.forEach((h, i) => {
      lines.push('  [' + (i + 1) + '] ' + h.title + '  · ' + h.via);
      if (h.description) lines.push('      ' + h.description);
      lines.push('      licence: ' + h.licence + (h.artist ? '  by ' + h.artist : ''));
      lines.push('      ' + h.url);
    });
  }
  lines.push('\nEvery URL above was fetched and does serve an image. What is NOT checked is whether it is the right place — read the title and description and decide. If none of them match, say so and use a map instead: every stay has coordinates, and a map of where they are actually sleeping beats a stock photo of somewhere else.');
  return lines.join('\n');
}

// --- one place, for a chat card ---------------------------------------------
//
// raffy, 2026-09-01: "in chat especially. when discussing option, locations etc
// , i need pictures . and I need the direct link to the think so i don't have
// to go out the app and type... we want them to be in our app as much as
// possible."
//
// The agent cannot be relied on for either. It can give a link it read in a
// search result, but not a photograph — there is no free Google Images API, an
// image URL scraped out of a page usually blocks hotlinking, and we have
// already lost an evening to exactly that failure (Wikimedia, then Carto, both
// fine from the server and dead on his phone).
//
// Places has the real photograph, the real rating and the venue's own website,
// keyed by nothing more than the name we are already showing on the card. So
// the CARD asks for its own picture rather than the agent guessing one.
//
// Cached in module memory because the same hotel is discussed across several
// turns and every miss is a billed search. It is deliberately small and
// process-local: a cache that needs a database is a different feature.
const PRICE_WORD = {
  PRICE_LEVEL_FREE: 'free',
  PRICE_LEVEL_INEXPENSIVE: 'cheap',
  PRICE_LEVEL_MODERATE: 'mid-range',
  PRICE_LEVEL_EXPENSIVE: 'expensive',
  PRICE_LEVEL_VERY_EXPENSIVE: 'very expensive',
};

/**
 * One place, from Google, cached.
 *
 * `near` is a list of localities the same place might already be filed under.
 * Nothing is added to the request — these are purely extra cache keys to check
 * before paying, which is what stops the photo fill on a two-city trip
 * re-buying places the chat looked up an hour earlier.
 */
export async function lookupPlace(query, { near = [] } = {}) {
  const q = String(query || '').trim().slice(0, 200);
  if (!q) return null;
  if (!placesKey()) return null;
  // Cached under the unqualified key, sent to Google in full. place_details
  // asks for "Tam Coc Garden Resort Ninh Binh, Vietnam" and find_photos for the
  // same hotel without the country; the request keeps the country because it
  // matches better, the cache drops it because it is the same hotel.
  const key = unqualified(placeKey(q));
  return cached(key, () => lookupPlaceNow(q),
    { alsoTry: (near || []).map((c) => unqualified(placeKey(q + ' ' + c))).filter((k) => k !== key) });
}

// The billed half, called only on a genuine cache miss.
async function lookupPlaceNow(q) {
  const key = placesKey();
  if (!key) return null;

  let out = null;
  try {
    const res = await fetchWith(PLACES + 'places:searchText', T_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': key,
        // Places bills by field mask. Everything asked for here is shown on
        // the card; nothing is fetched speculatively.
        // One mask, two consumers: the chat card and the place_details tool.
        // Everything here is in the SKU the rating already put us in, so the
        // hours, the phone and the price level cost nothing extra — and the
        // card and the tool then share one cached answer instead of paying
        // for the same hotel twice.
        'x-goog-fieldmask':
          'places.displayName,places.formattedAddress,places.rating,'
          + 'places.userRatingCount,places.photos,places.websiteUri,places.googleMapsUri,'
          + 'places.location,places.businessStatus,places.priceLevel,'
          + 'places.regularOpeningHours,places.nationalPhoneNumber',
        'user-agent': UA,
      },
      body: JSON.stringify({ textQuery: q, pageSize: 1 }),
    });
    if (res.ok) {
      const p = ((await res.json()).places || [])[0];
      if (p) {
        const ref = ((p.photos || [])[0] || {}).name;
        out = {
          name: plain((p.displayName && p.displayName.text) || '').slice(0, 90),
          address: plain(p.formattedAddress || '').slice(0, 140),
          photo: ref && PHOTO_REF.test(ref) ? photoProxy(ref) : '',
          rating: Number.isFinite(p.rating)
            ? p.rating + (p.userRatingCount ? ' on Google, ' + p.userRatingCount.toLocaleString('en') + ' reviews' : ' on Google')
            : '',
          site: /^https:\/\//.test(p.websiteUri || '') ? p.websiteUri : '',
          maps: p.googleMapsUri || '',
          lat: Number.isFinite(p.location && p.location.latitude) ? p.location.latitude : null,
          lon: Number.isFinite(p.location && p.location.longitude) ? p.location.longitude : null,
          // The single most damaging thing to get wrong: recommending dinner
          // somewhere that shut last year.
          closed: p.businessStatus === 'CLOSED_PERMANENTLY',
          level: PRICE_WORD[p.priceLevel] || '',
          hours: ((p.regularOpeningHours || {}).weekdayDescriptions || []).slice(0, 7),
          phone: plain(p.nationalPhoneNumber || ''),
        };
      }
    }
  } catch (err) {
    // A card without a picture is fine. A card that never renders is not.
    out = null;
  }

  // A miss is returned as null and cached as null by the caller — a place
  // Google does not know will not start knowing it this month, and re-asking
  // is the expensive half.
  return out;
}

// --- filling the gaps --------------------------------------------------------
//
// raffy, 2026-09-02: "in the app, i want all places mention (ideas , itenary ,
// hotels) all have photos."
//
// The builder attaches a photo when it happens to look one up, and across his
// three real trips that came to 10, 14 and 7 out of thirty-odd places. The rest
// were blank — including Explore cards, on a tab that is browsed by picture.
//
// Asking the builder to try harder is the move that has failed all day. So the
// app fills the gaps itself, from Google Places, by name. Three things keep it
// cheap:
//
//   - Only real places. "Check out", "Drive home" and "Early night" are not
//     things Google can find and not things anybody wants a picture of.
//   - Paid for once. The answers are stored per session, so a poll can never
//     spend money and a rebuild does not re-buy a photo of the same hotel.
//   - Bounded per pass, so a pathological itinerary cannot run up a bill.

// Logistics, not places. Deliberately anchored at the start of the heading:
// "Back to Positano" is a move, "Positano" is a place.
const LOGISTICS = /^(check ?-? ?(back ?)?(in|out)|depart|leave|land|arrive|drive|fly|taxi|transfer|nap|slow (start|morning)|early night|back (to|down|home|at)|head (back|to|out)|return to|settle in|pack|last (swim|morning)|swim stop|evening flight|train (on|to)|bus to|ferry to|or:|free (time|morning|afternoon)|rest|breakfast at the (hotel|resort)|what to)/i;

// "Dinner at Desaru Seafood Corner" and the Explore card "Desaru Seafood
// Corner" are the same restaurant, and paying Google twice for a picture of it
// is the whole cost of this feature doubled. What you did there is stripped;
// what you did it at is the key.
const DOING = /^((dinner|lunch|breakfast|brunch|supper|drinks|coffee|tea|visit|explore|stop|stroll|wander|walk|tour|swim|shop|shopping|sunset|sunrise|morning|afternoon|evening|day)\s+(at|in|to|around|through|by|on)\s+|(browse|see|catch|try|sample|grab|revisit|photograph)\s+(the\s+)?)/i;

// A name Google could find, rather than a description of an afternoon.
//
// Two cheap tests catch most of the waste, and every one they catch is a billed
// lookup that would have come back with nothing:
//
//   "Beach and pool"                    no proper noun anywhere
//   "Early dinner, easy night"          a clause, not a name
//   "Villa plunge pool, then the beach" same
//   "Marina Grande, Sorrento"           kept: what follows the comma is a place
//
// Deliberately lenient at the margin. A missed lookup costs a blank card; an
// over-eager filter costs a picture of somewhere real.
function looksLikeAPlace(n) {
  // A description continues in lower case after its break. A name does not.
  if (/[,—–-]\s+[a-z]/.test(n)) return false;
  // Something in it has to be a proper noun beyond the opening word, which is
  // capitalised in every heading regardless.
  return /\s[A-Z0-9]/.test(n);
}

// The place inside a heading.
//
// Read off the Hanoi run on 2026-09-05, where the fill sent Google the whole
// heading — "Egg coffee at Café Giảng", "Boat ride through Tam Coc", "Walk
// Hoan Kiem Lake", "Lunch around Truc Bach". Every one is a billed search for
// a sentence, and every one had a perfectly good place name inside it.
//
// The old code stripped these for the CACHE KEY and then looked up the raw
// heading anyway, so the saving was never real. Now one function does both.
const ACTIVITY = /\b(boat ride|ride|cruise|lunch|dinner|breakfast|brunch|supper|drinks|coffee|tea|evening|morning|afternoon|night|walk|stroll|wander|tour|visit|stop|swim|shopping|food|snack|sunset|sunrise|day)\b/i;

export function placeNameFrom(heading) {
  let n = String(heading || '').trim();
  // "Lunch: bún chả at Hương Liên" — what matters is after the colon.
  const colon = n.indexOf(':');
  if (colon > 0 && colon < n.length - 3) n = n.slice(colon + 1).trim();

  // "Last Old Quarter dinner" -> "Old Quarter".
  n = n.replace(/^(the\s+)?(last|first|final|early|late)\s+/i, '');
  n = n.replace(/[\s,]+(dinner|lunch|breakfast|brunch|drinks|coffee|stop|walk|boat ride|ride|cruise)$/i, '');

  // What follows the preposition, when what PRECEDES it is an activity rather
  // than a name. "Turmeric at Anantara" is a restaurant inside a resort and the
  // whole string is the better query; "Egg coffee at Café Giảng" is a thing you
  // do at a place. The difference is whether an activity word appears at all,
  // checked against the original heading so the meal word in "Lunch: bún chả at
  // Hương Liên" still counts after the colon has been dropped.
  //
  // "of" is deliberately not a splitter: Temple of Literature is one place.
  if (ACTIVITY.test(heading)) {
    const after = n.match(/\b(?:at|through|around|in|near|along)\s+(?:the\s+)?([A-Z\u00C0-\u1EF9\u0100-\u024F][^,]*)$/);
    if (after && after[1].trim().length > 2) n = after[1].trim();
  }

  // A bare leading verb: "Walk Hoan Kiem Lake", "Browse Dong Xuan Market".
  n = n.replace(/^(walk|browse|explore|visit|see|tour|stroll|wander|climb|cycle|kayak|hike|revisit|photograph)\s+(the\s+)?(?=[A-Z\u00C0-\u1EF9\u0100-\u024F])/i, '');

  return n.replace(/\s+/g, ' ').trim();
}

export const fillKey = (s) => placeNameFrom(String(s || '').replace(DOING, ''))
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Everything in an itinerary that is a place and is missing a picture or a
// position.
export function photoGaps(it) {
  const out = [];
  const seen = new Set();
  const want = (name, o) => {
    const n = String(name || '').trim();
    if (!o || !n || n.length < 3) return;
    // A place the builder already gave a photo to still needs looking up if
    // nobody knows where it is — the map cannot draw what has no coordinates,
    // and a half-drawn map is worse than the old hotels-only one. Bounded by
    // the same `max` as everything else, so a trip cannot run away with it.
    if (o.photo && isFinite(+o.lat) && isFinite(+o.lon)) return;
    if (LOGISTICS.test(n)) return;
    if (!looksLikeAPlace(n)) return;
    const k = fillKey(n);
    if (!k || seen.has(k)) return;
    seen.add(k);
    // The extracted name is what gets SENT, not just what gets keyed. Sending
    // the heading was the whole waste.
    out.push({ key: k, name: placeNameFrom(n.replace(DOING, '')) || n });
  };
  for (const st of (it && it.stays) || []) want(st.n || st.short, st);
  for (const i of (it && it.ideas) || []) want(i.n || i.h, i);
  for (const d of (it && it.days) || []) for (const x of d.items || []) want(x.h, x);
  return out;
}

// One filled place. A bare string is the old shape — a photo URL and nothing
// else — and there are live trips holding those, so both are read forever.
//
// The coordinates come free: this lookup already asks Google for the place and
// already gets `lat`/`lon` back in the same response. Throwing them away is why
// the map could only ever draw hotels, and picking them up costs nothing.
const fillOf = (v) => (v && typeof v === 'object' ? v : { u: v || '' });

// Look up the ones we have not already paid for. Returns the merged store.
// The trip title is a display string, not a locality. On a one-base trip it is
// close enough to a city to be worth appending — "Dong Xuan Market, Hanoi"
// beats "Dong Xuan Market" for both matching and cost, since it is the same
// query the builder's own photo search sends.
//
// On a trip that moves it is actively harmful. The Hanoi run on 2026-09-05
// looked up "Dong Xuan Market, Hanoi & Ninh Binh" — a market in one city
// qualified by two, which matches worse AND misses the cache entry the builder
// already paid for. So a title naming more than one place qualifies nothing.
// "Hanoi & Ninh Binh" -> ["Hanoi", "Ninh Binh"]. Only ever used to look in the
// cache, never to build a request, so being generous costs nothing.
export const localities = (title) => String(title || '')
  .split(/\s*(?:&|\band\b|\/|\u2192|\u2014|,|\bto\b)\s*/i)
  .map((x) => x.trim())
  .filter((x) => x.length > 2 && x.length < 40)
  .slice(0, 4);

export const localise = (title) => {
  const t = String(title || '').trim();
  if (!t || /\s(&|and|to|\/|→|—)\s|,/.test(t)) return '';
  return t;
};

export async function fillPhotoGaps(it, known = {}, { city = '', max = 24 } = {}) {
  if (!placesKey()) return known;
  const where = localise(city);
  // On a trip that moves, the title names every city and so qualifies none of
  // the lookups. These are the cities to CHECK the cache under, not to send.
  const near = where ? [] : localities(city);
  // `done` marks a key we have already paid to look up, hit or miss — a place
  // Google does not know will not start knowing it. Entries written before
  // coordinates were kept have no `done`, so they are looked up once more and
  // then settled: that one-time cost is what puts existing trips on the map.
  const todo = photoGaps(it)
    .filter((g) => !fillOf(known[g.key]).done)
    .slice(0, max);
  if (!todo.length) return known;

  const out = { ...known };
  await Promise.all(todo.map(async (g) => {
    try {
      const p = await lookupPlace(where ? g.name + ', ' + where : g.name, { near });
      // A miss is remembered as a miss. A place Google does not know will not
      // start knowing it, and re-asking every build is the expensive half.
      const row = { u: (p && p.photo) || '', done: 1 };
      if (p && isFinite(+p.lat) && isFinite(+p.lon)) { row.lat = +p.lat; row.lon = +p.lon; }
      out[g.key] = row;
    } catch (err) {
      // Leave it unrecorded so a transient failure gets another go later,
      // rather than being cached as "there is no photo of this".
    }
  }));
  return out;
}

/**
 * Coordinates for a place we have already looked up, if there are any.
 *
 * Old fill entries are photo URLs with no position, and a trip built before
 * this simply has fewer pins rather than a broken map — the next build fills
 * them in.
 */
export function fillWhere(fill, name) {
  const r = fillOf((fill || {})[fillKey(name)]);
  return isFinite(r.lat) && isFinite(r.lon) ? { lat: r.lat, lon: r.lon } : null;
}

// Pure: no network, safe to run on every read.
export function applyFill(it, fill) {
  if (!it || !fill || !Object.keys(fill).length) return it;
  const next = { ...it, photos: { ...(it.photos || {}) } };
  let used = false;
  const take = (name, o) => {
    if (!o) return o;
    const r = fillOf(fill[fillKey(name)]);
    let got = o;
    if (!got.photo && r.u) {
      const key = 'fill:' + fillKey(name);
      next.photos[key] = r.u;
      used = true;
      got = { ...got, photo: key };
    }
    // Where it is, for anything that did not already carry coordinates. The
    // builder only ever writes them on stays, which is why the map only ever
    // had hotels on it.
    if (!isFinite(+got.lat) && isFinite(r.lat) && isFinite(r.lon)) {
      used = true;
      got = { ...got, lat: r.lat, lon: r.lon };
    }
    return got;
  };
  next.stays = (next.stays || []).map((st) => take(st.n || st.short, st));
  next.ideas = (next.ideas || []).map((i) => take(i.n || i.h, i));
  next.days = (next.days || []).map((d) => ({ ...d, items: (d.items || []).map((x) => take(x.h, x)) }));
  return used ? next : it;
}
