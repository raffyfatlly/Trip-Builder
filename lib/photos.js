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
    const res = await fetch(url, {
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
  const res = await fetch(pageUrl, {
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

async function fromGoogle(search, limit) {
  const key = placesKey();
  if (!key) return [];
  const res = await fetch(PLACES + 'places:searchText', {
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
      url: '/api/photo?ref=' + encodeURIComponent(ref),
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
  const res = await fetch(url, { headers: { 'user-agent': UA } });
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
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
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
  const settled = await Promise.allSettled([
    fromGoogle(search, 3), fromCommons(search, 4), fromOpenverse(search, 4),
  ]);
  const seen = new Set();
  const all = [];
  // Interleave so one source cannot crowd the other out of the shortlist.
  const lists = settled.map((r) => (r.status === 'fulfilled' ? r.value : []));
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

  const results = await Promise.all(list.map(async (q) => ({ q, ...(await resolveOne(q)) })));

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
