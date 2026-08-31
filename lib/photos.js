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
    'Find real, working photo URLs. Searches Wikimedia Commons and Openverse, checks every result actually loads, and returns the ones that do with their licence. Ask for several at once. If the traveller has given you a direct image URL, pass it as `url` and it is checked and handed straight back. You still judge whether each result is genuinely the place you wanted — read the title and description, and skip anything that is not clearly right.',
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
            search: { type: 'string', description: 'What to search for, e.g. "Dragon Bridge Da Nang". Leave out if you are passing a url.' },
            url: { type: 'string', description: 'A direct image URL the traveller gave you, to check and use as-is.' },
          },
          required: ['key'],
        },
      },
    },
    required: ['queries'],
  },
};

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
  const settled = await Promise.allSettled([fromCommons(search, 4), fromOpenverse(search, 4)]);
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
  const checked = await Promise.all(all.map(async (h) => ((await loads(h.url)) ? h : null)));
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
  if (!q.search) return { hits: [], note: 'no search terms and no url' };
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
  lines.push('\nEvery URL above was fetched and does serve an image. What is NOT checked is whether it is the right place — read the title and description and decide. If none of them match, use no photo.');
  return lines.join('\n');
}
