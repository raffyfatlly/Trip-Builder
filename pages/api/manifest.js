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

const ICON = (label) => {
  // Drawn rather than fetched: an icon file would be one more thing to serve,
  // and the letter of the destination is a better home-screen icon than a
  // generic pin anyway.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">'
    + '<rect width="512" height="512" rx="112" fill="#10362A"/>'
    + '<text x="256" y="330" font-family="Outfit, system-ui, sans-serif" font-size="260"'
    + ' font-weight="800" fill="#EAF2EC" text-anchor="middle">'
    + String(label || 'T').slice(0, 1).toUpperCase() + '</text></svg>';
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
};

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
    // An SVG icon has to declare sizes:"any" or Chrome will not count it
    // toward installability, and without an acceptable icon the browser never
    // fires beforeinstallprompt — so the Install button would simply never
    // appear and there would be nothing on screen to say why.
    icons: [
      { src: ICON(title), sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: ICON(title), sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
      { src: ICON(title), sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }));
}

export default billed(handler);
