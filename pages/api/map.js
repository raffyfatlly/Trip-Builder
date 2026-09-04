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
// The app's palette, as Static Maps styling.
//
// raffy, 2026-09-05: "something like phu quoc . its artistic."
//
// His Phu Quoc map is an illustration: one shape of pale land on one field of
// water, and nothing else. A street map with the colours changed is still a
// street map — the roads, the district names and the motorway shields are what
// make it read as Google rather than as his app.
//
// So everything that is not land, water or a town name is turned off. What is
// left is the silhouette, which is the part that carries the trip.
const STYLE = [
  'feature:all|element:geometry|color:0xF2F8F3',
  // Every label, gone. The Phu Quoc map has four names on it and all four are
  // ours, placed where they belong to the trip. Google's own — every kampung
  // and industrial estate inside the frame — are what made this read as a
  // street map with the colours changed. The app writes the names that matter.
  'feature:all|element:labels|visibility:off',
  'feature:administrative|element:geometry|visibility:off',
  'feature:landscape|element:geometry|color:0xF3F8F3',
  'feature:landscape.natural|element:geometry|color:0xEDF6EF',
  'feature:poi|visibility:off',
  'feature:poi.park|element:geometry|color:0xDFEEE1',
  // Roads carry no names and almost no colour, but they are not off.
  //
  // Turning them off entirely was right for Phu Quoc and wrong everywhere
  // inland: planning Chiang Mai for real produced a pale empty rectangle with
  // dots on it, because an island gets its shape from the sea and a landlocked
  // city gets it from its streets. So the big ones stay, a shade off the land,
  // as texture rather than as a street map — and the labels stay off, which is
  // what actually made it look fetched.
  'feature:road|element:labels|visibility:off',
  'feature:road|element:geometry|color:0xDCE9DF',
  'feature:road.local|visibility:off',
  'feature:road.arterial|element:geometry|color:0xD6E5DA',
  'feature:road.highway|element:geometry|color:0xC9DCCE',
  'feature:road.highway.controlled_access|element:geometry|color:0xBFD5C6',
  'feature:transit|visibility:off',
  // NOT the colour raffy picked, and that is deliberate — flag it if he asks.
  //
  // He chose 0xCFE8E3 (RGB 207, 232, 227) on 2026-09-01, for a map whose land
  // was cream and whose roads carried the shape. With the roads gone the whole
  // illustration IS the contrast between land and sea, and at his value the
  // coastline nearly disappears — rendered both and looked. This is the same
  // hue carrying enough weight to hold an edge, and closer to his own Phu Quoc
  // map, which is what he asked this to look like on 2026-09-05.
  //
  // One line to put back if he prefers his.
  'feature:water|element:geometry|color:0xA6CBC3',
  'feature:water|element:labels|visibility:off',
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
