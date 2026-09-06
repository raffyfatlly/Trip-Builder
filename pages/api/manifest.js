// The manifest that makes one trip installable.
//
// raffy, 2026-09-06: "Download as PWS app (like my phu quoc I can download as
// app.)"
//
// His Phu Quoc app was installable because it was SERVED: a manifest and a
// service worker sitting next to it at real URLs. A single downloaded HTML file
// can never be — file:// cannot register a worker and there is nothing for a
// manifest to point at — so the install path is the hosted trip page at
// /t/<session>, and this is its manifest.
//
// Per trip on purpose: the name, the colour and the start URL are this trip's,
// so what lands on the home screen says "Chiang Mai" rather than the name of
// the tool that made it.

import { getState } from '../../lib/managedAgents.js';
import { billed } from '../../lib/billed.js';

// PNG, not SVG, and this is the whole reason the installed app used to carry a
// little Chrome badge in its corner.
//
// Android only mints a REAL installed app (a WebAPK) from a raster icon. Given
// an SVG it cannot, so it falls back to a plain browser shortcut — and a
// shortcut is exactly what gets badged. raffy, 2026-09-06: "remove the chrome
// thingy attached to it."
//
// One mark for every trip rather than the destination's initial: a letter drawn
// into an SVG could never be rasterised here, and the trip's own name already
// sits under the icon on the home screen. The mark is the app's own motif — the
// dashed journey curve off the trip map, with a coral waypoint at the end.
const ICONS = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  // Cropped to whatever shape the launcher uses, so its mark sits inside the
  // middle 80%.
  { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

async function handler(req, res) {
  const session = String(req.query.s || '');
  if (!session) return res.status(400).json({ error: 'session required' });

  let title = 'Trip';
  try {
    const state = await getState(session);
    const it = state && state.itinerary;
    title = (it && it.trip && it.trip.title) || title;
  } catch (err) {
    // A manifest that cannot name the trip is still a working manifest.
  }

  res.setHeader('content-type', 'application/manifest+json; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=300');
  // send(), not json(): res.json() overwrites the content type with
  // application/json and the whole point of setting it was to be a manifest.
  return res.status(200).send(JSON.stringify({
    name: title,
    short_name: String(title).slice(0, 12),
    start_url: '/t/' + encodeURIComponent(session),
    scope: '/t/' + encodeURIComponent(session),
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#EDF2EA',
    theme_color: '#10362A',
    icons: ICONS,
  }));
}

export default billed(handler);
