import { fetchWith } from '../../lib/net.js';
import { placesKey } from '../../lib/photos.js';
import { billed } from '../../lib/billed.js';

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
  // raffy picked this one himself: RGB 207, 232, 227.
  'feature:water|element:geometry|color:0xCFE8E3',
  'feature:water|element:labels.text.fill|color:0x6E938C',
];

const COORD = /^-?\d{1,3}(\.\d{1,6})?$/;

async function handler(req, res) {
  const key = placesKey();
  if (!key) return res.status(501).json({ error: 'maps are not configured' });

  const [lat, lon] = String((req.query && req.query.c) || '').split(',');
  const zoom = parseInt(req.query.z, 10);
  if (!COORD.test(lat || '') || !COORD.test(lon || '')) {
    return res.status(400).json({ error: 'bad centre' });
  }
  if (!(zoom >= 1 && zoom <= 20)) return res.status(400).json({ error: 'bad zoom' });

  // 512 is what every itinerary built before 2026-09-05 asks for, and those
  // files are downloaded and opened offline for months. The default is not
  // negotiable.
  const asked = parseInt(req.query.w, 10);
  const width = asked >= 200 && asked <= 640 ? asked : 512;

  const q = new URLSearchParams({
    center: lat + ',' + lon,
    zoom: String(zoom),
    // Portrait, because a phone is. raffy, 2026-09-01: "i want the map bigger
    // like phu quoc style . looks nicer" — and again on 2026-09-05: "enlarge
    // the map so it can take the whole screen on mobile. i want user to have
    // that immersive feeling."
    //
    // Height is pinned at 640 because Static Maps caps `size` there, so the
    // only way to a taller shape is a narrower one — which is why the width is
    // asked for rather than fixed. The page measures the space the map will
    // actually fill and requests that shape, so a full-screen phone map is not
    // a 512x640 tile cropped down the sides.
    //
    // Whatever comes back, the pins are drawn in this same coordinate space:
    // renderer/render.js reads `w` back out of the URL it built. A tile of a
    // different shape puts every marker in the wrong place.
    size: width + 'x640',
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

export default billed(handler);
