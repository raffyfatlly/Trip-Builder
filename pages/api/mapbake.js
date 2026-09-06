// The map, as bytes, so a saved trip still has a map.
//
// raffy, 2026-09-06, on downloading the trip as an app and as a PDF: "just that
// I see the map background will be lost?"
//
// It would. The ground is one <img> pointing at /api/map on this server, so a
// file opened from disk asks file:///api/map and gets nothing, and print gives
// a blank rectangle where the map was. Same problem the photographs had, same
// answer: fetch it here, where the Google key lives, and hand back a data URI.
//
// The centre and zoom are worked out with lib/mapfit.js — the same function the
// app itself runs — because a ground drawn for a different zoom than the pins
// are placed at is worse than no ground.

import { fetchWith } from '../../lib/net.js';
import { billed } from '../../lib/billed.js';
import { groundQuery, mapPoints, BAKE_W } from '../../lib/mapfit.js';

const T_MAP = 12000;
const MAX = 4_000_000;

export const config = { api: { responseLimit: false } };

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const it = (req.body && req.body.itinerary) || null;
  const pts = mapPoints(it);
  // No coordinates, no map. The app already draws nothing in that case.
  if (!pts.length) return res.status(200).json({ ground: null });

  const q = groundQuery(pts, Number(req.body && req.body.w) || BAKE_W);

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return res.status(200).json({ ground: null });
  const proto = /^localhost|^127\./.test(host) ? 'http' : 'https';
  const url = proto + '://' + host + '/api/map?c=' + encodeURIComponent(q.c)
    + '&z=' + q.z + '&w=' + q.w;

  try {
    const r = await fetchWith(url, T_MAP);
    if (!r.ok) return res.status(200).json({ ground: null });
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (!/^image\//i.test(type)) return res.status(200).json({ ground: null });
    const buf = Buffer.from(await r.arrayBuffer());
    // A ground that doubles the size of the file is not worth having; the app
    // falls back to its flat sage ground, which is what it did before any of
    // this and looks fine.
    if (!buf.length || buf.length > MAX) return res.status(200).json({ ground: null });
    return res.status(200).json({
      ground: {
        url: 'data:' + type + ';base64,' + buf.toString('base64'),
        cLat: q.cLat, cLon: q.cLon, z: q.z, w: q.w,
      },
    });
  } catch (err) {
    // Never a reason to fail a download. Best effort, exactly like the photos.
    console.error('map bake failed:', err && err.message);
    return res.status(200).json({ ground: null });
  }
}

export default billed(handler);
