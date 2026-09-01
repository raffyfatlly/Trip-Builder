import { fetchWith } from '../../lib/net.js';
import { placesKey } from '../../lib/photos.js';

// A styled map of the trip, served from here.
//
// raffy, 2026-09-01: "cant we use like for Google map api or something ? cause
// im seeing api key required."
//
// Two problems this solves at once. Wikimedia restricts third-party
// hotlinking, and Carto now gates its basemaps behind a key — both loaded on
// the server and failed on his phone, which is the worst possible way for a
// dependency to fail. And Google Static Maps takes a `style` parameter, so the
// ground can be drawn in the app's own palette rather than in somebody else's
// default green-and-yellow. That is what gets it close to the hand-drawn Phu
// Quoc map: it is the same colours as everything around it.
//
// The key stays here. The page asks for /api/map and never sees it, which
// matters because a generated itinerary gets downloaded and shared.

// The app's palette, as Static Maps styling. Cream land, sage parks, pale
// water, white roads — the same values as --bg, --sage and --surface.
const STYLE = [
  'feature:all|element:geometry|color:0xF4F1EA',
  'feature:all|element:labels.text.fill|color:0x4C6157',
  'feature:all|element:labels.text.stroke|color:0xFFFFFF|weight:2.5',
  'feature:all|element:labels.icon|visibility:off',
  'feature:administrative|element:geometry.stroke|color:0xD8D3C8',
  'feature:administrative.land_parcel|visibility:off',
  'feature:landscape.natural|element:geometry|color:0xEDEAE1',
  'feature:poi|element:labels|visibility:off',
  'feature:poi.park|element:geometry|color:0xE2EBDE',
  'feature:road|element:geometry|color:0xFFFFFF',
  'feature:road|element:geometry.stroke|color:0xE8E4DC',
  'feature:road.arterial|element:labels|visibility:off',
  'feature:road.local|element:labels|visibility:off',
  'feature:road.highway|element:geometry|color:0xF7F2E7',
  'feature:road.highway|element:geometry.stroke|color:0xE3DCCB',
  'feature:transit|visibility:off',
  // raffy picked this one himself, as hsl(120,38%,82%).
  'feature:water|element:geometry|color:0xC0E3C0',
  'feature:water|element:labels.text.fill|color:0x6E8F6E',
];

const COORD = /^-?\d{1,3}(\.\d{1,6})?$/;

export default async function handler(req, res) {
  const key = placesKey();
  if (!key) return res.status(501).json({ error: 'maps are not configured' });

  const [lat, lon] = String((req.query && req.query.c) || '').split(',');
  const zoom = parseInt(req.query.z, 10);
  if (!COORD.test(lat || '') || !COORD.test(lon || '')) {
    return res.status(400).json({ error: 'bad centre' });
  }
  if (!(zoom >= 1 && zoom <= 20)) return res.status(400).json({ error: 'bad zoom' });

  const q = new URLSearchParams({
    center: lat + ',' + lon,
    zoom: String(zoom),
    // Portrait, because a phone is. raffy, 2026-09-01: "i want the map bigger
    // like phu quoc style . looks nicer" — and the Phu Quoc map is a tall card
    // that fills the screen, not a letterbox.
    //
    // 512 wide rather than 640 because Static Maps caps `size` at 640 in both
    // directions, so height is the scarce one: 512x640 is the tallest shape
    // available. scale=2 still delivers 1024x1280 real pixels into a ~354px
    // card, which is more than sharp enough.
    //
    // Must match MW/MH and the .rmap aspect-ratio in renderer/render.js — the
    // pins are drawn in this coordinate space, so a tile of a different shape
    // puts every one of them in the wrong place.
    size: '512x640',
    scale: '2',
    maptype: 'roadmap',
    key,
  });
  for (const s of STYLE) q.append('style', s);

  try {
    const up = await fetchWith('https://maps.googleapis.com/maps/api/staticmap?' + q, 10000,
      { redirect: 'follow' });
    const type = up.headers.get('content-type') || '';
    // Static Maps answers a misconfiguration with a 200 and a PNG that says
    // so in words. Treat a non-image as the failure it is; anything else and
    // the app would proudly display a picture of an error message.
    if (!up.ok || !/^image\//i.test(type)) {
      return res.status(502).json({ error: 'map unavailable' });
    }
    res.setHeader('content-type', type);
    res.setHeader('cache-control', 'public, max-age=2592000, immutable');
    res.status(200).send(Buffer.from(await up.arrayBuffer()));
  } catch (err) {
    res.status(502).json({ error: 'could not fetch that map' });
  }
}
