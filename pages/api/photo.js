import { PHOTO_REF, photoMediaUrl, placesKey } from '../../lib/photos.js';
import { fetchWith } from '../../lib/net.js';

// A Google Places photo, served from here.
//
// The Places media URL needs the API key in the query string, and these URLs
// end up inside an itinerary that gets downloaded, shared and opened on other
// people's phones. So the itinerary stores /api/photo?ref=… and this fetches
// the bytes with the key, which never leaves the server.
//
// Cached hard: a hotel's photo does not change, and every re-render of an
// itinerary would otherwise be a fresh billed request.

export const config = { api: { responseLimit: false } };

export default async function handler(req, res) {
  const ref = String((req.query && req.query.ref) || '');
  if (!PHOTO_REF.test(ref)) return res.status(400).json({ error: 'bad ref' });
  if (!placesKey()) return res.status(501).json({ error: 'photos are not configured' });

  const width = Math.min(Math.max(parseInt(req.query.w, 10) || 1200, 200), 1600);

  try {
    const up = await fetchWith(photoMediaUrl(ref, width), 10000, { redirect: 'follow' });
    const type = up.headers.get('content-type') || '';
    if (!up.ok || !/^image\//i.test(type)) return res.status(502).json({ error: 'no image' });

    res.setHeader('content-type', type);
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.status(200).send(Buffer.from(await up.arrayBuffer()));
  } catch (err) {
    res.status(502).json({ error: 'could not fetch that photo' });
  }
}
