// Finding photos, server-side.
//
// The builder originally constructed Wikimedia API URLs and fetched them
// itself. That cannot work: Managed Agents' web_fetch only retrieves URLs that
// already appear in the conversation, so a URL the model assembles is refused
// with url_not_accessible. Every attempt failed and the itinerary came out
// with no pictures at all.
//
// So the lookup happens here instead. The agent asks for "a photo of the
// Dragon Bridge"; this queries Commons, validates what comes back, and returns
// real hotlinkable URLs with their attribution. The agent still decides
// whether a candidate is genuinely the right place — that judgement is not
// something to automate.

const API = 'https://commons.wikimedia.org/w/api.php';

// Only direct image files on Wikimedia's CDN are usable: those permit
// hotlinking and their URLs are stable. Anything else is dropped rather than
// returned and rendered as a broken picture later.
const usable = (u) =>
  typeof u === 'string' &&
  /^https:\/\/upload\.wikimedia\.org\//.test(u) &&
  /\.(jpe?g|png|webp)$/i.test(u.split('?')[0]);

const plain = (s) =>
  String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

export const FIND_TOOL = {
  type: 'custom',
  name: 'find_photos',
  description:
    'Search Wikimedia Commons for photos and get back real, hotlinkable image URLs with their licence. Ask for several at once. You still judge whether each result is actually the place you wanted — check the title and description before using it, and skip anything that is not clearly right.',
  input_schema: {
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        description: 'Up to 8 searches in one call.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'The photo key you will use in the itinerary, e.g. "dragonbridge".' },
            search: { type: 'string', description: 'What to search for, e.g. "Dragon Bridge Da Nang".' },
          },
          required: ['key', 'search'],
        },
      },
    },
    required: ['queries'],
  },
};

async function searchOne(search, limit = 3) {
  const url = API + '?' + new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: search,
    gsrnamespace: '6',            // File: namespace only
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '1200',
    format: 'json',
    origin: '*',
  });

  const res = await fetch(url, {
    headers: { 'user-agent': 'TripBuilder/1.0 (itinerary photos)' },
  });
  if (!res.ok) throw new Error('commons ' + res.status);
  const data = await res.json();

  const pages = (data && data.query && data.query.pages) || {};
  const out = [];
  for (const id of Object.keys(pages)) {
    const p = pages[id] || {};
    const info = (p.imageinfo || [])[0] || {};
    const meta = info.extmetadata || {};
    // thumburl is the resized copy; fall back to the original if absent.
    const src = usable(info.thumburl) ? info.thumburl : (usable(info.url) ? info.url : null);
    if (!src) continue;
    out.push({
      title: plain(p.title).replace(/^File:/, ''),
      url: src,
      description: plain(meta.ImageDescription && meta.ImageDescription.value).slice(0, 220),
      licence: plain(meta.LicenseShortName && meta.LicenseShortName.value) || 'see Commons',
      artist: plain(meta.Artist && meta.Artist.value).slice(0, 80),
    });
  }
  return out;
}

// Returns text for the agent: candidates per key, or an honest note that
// nothing usable was found. Never invents a URL to fill a gap.
export async function findPhotos(queries) {
  const list = (queries || []).slice(0, 8);
  if (!list.length) return 'No queries given.';

  const results = await Promise.all(list.map(async (q) => {
    try {
      const hits = await searchOne(q.search);
      return { q, hits };
    } catch (err) {
      return { q, hits: [], error: err.message };
    }
  }));

  const lines = [];
  for (const { q, hits, error } of results) {
    lines.push('\n' + q.key + '  (searched: ' + q.search + ')');
    if (error) { lines.push('  lookup failed: ' + error); continue; }
    if (!hits.length) { lines.push('  nothing usable found — leave this one without a photo'); continue; }
    hits.forEach((h, i) => {
      lines.push('  [' + (i + 1) + '] ' + h.title);
      if (h.description) lines.push('      ' + h.description);
      lines.push('      licence: ' + h.licence + (h.artist ? '  by ' + h.artist : ''));
      lines.push('      ' + h.url);
    });
  }
  lines.push('\nUse a URL only if the title and description show it really is the place you wanted. Pass it to add_photos with a caption and the licence. If none of the candidates match, use no photo.');
  return lines.join('\n');
}
