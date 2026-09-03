// Turn the trip's photo URLs into the photos themselves.
//
// raffy, 2026-09-03: "make sure the photos stay in app too."
//
// They did not. The saved file is one HTML document with the pictures left as
// URLs, and two of the three kinds die the moment it leaves the browser:
// /api/photo is a relative path, so from a file:// document it resolves to
// file:///api/photo and 404s, and anything on somebody else's host is one
// outage or one takedown away from a page of broken images. The trip he saved
// to keep is exactly the trip that has to survive both.
//
// So the download bakes them in. The fetch happens here rather than in the
// browser because a canvas cannot read a cross-origin image without CORS
// headers the source hosts do not send, and because /api/photo needs the key
// that never leaves the server.
//
// Best effort by design: a photo that will not load is returned as null and the
// app falls back to the map tile or the gradient it already falls back to. A
// picture is worth a wait; it is not worth a failed download.

import { fetchWith } from '../../lib/net.js';

const T_ONE = 8000;       // any single image
const T_ALL = 45000;      // the whole bake, however many
const MAX_ONE = 3_000_000;  // one photo
const MAX_ALL = 24_000_000; // the finished file has to open on a phone

const OK_TYPE = /^image\/(jpeg|png|webp|gif|avif)$/i;

export const config = { api: { responseLimit: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const urls = (req.body && req.body.urls) || {};
  const keys = Object.keys(urls).slice(0, 60);
  if (!keys.length) return res.status(200).json({ photos: {} });

  // Relative URLs (/api/photo?ref=…) need an origin to be fetchable at all.
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = proto + '://' + req.headers.host;

  const until = Date.now() + T_ALL;
  let budget = MAX_ALL;
  const photos = {};

  // Sequential, not parallel: sixty simultaneous image fetches is how you get
  // rate-limited by the host that was being generous.
  for (const k of keys) {
    if (Date.now() > until) break;
    const raw = String(urls[k] || '');
    if (!raw) continue;
    const url = raw.startsWith('/') ? origin + raw : raw;
    if (!/^https?:\/\//i.test(url)) continue;
    try {
      const r = await fetchWith(url, T_ONE, { redirect: 'follow' });
      if (!r.ok) continue;
      const type = (r.headers.get('content-type') || '').split(';')[0].trim();
      if (!OK_TYPE.test(type)) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length || buf.length > MAX_ONE || buf.length > budget) continue;
      budget -= buf.length;
      photos[k] = 'data:' + type + ';base64,' + buf.toString('base64');
    } catch (e) { /* this one stays a URL; the app already handles that */ }
  }

  res.status(200).json({ photos });
}
