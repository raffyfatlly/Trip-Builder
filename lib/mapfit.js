// Where the map is centred and how far in it is zoomed.
//
// Pulled out of the app's own JS so the SERVER can work out the exact same
// answer. raffy, 2026-09-06: "just that I see the map background will be lost?"
//
// He is right that it would be. The ground is one <img> pointing at /api/map on
// our server, so a downloaded trip opened from disk asks file:///api/map and
// gets nothing, and a PDF prints a blank rectangle where the map was. Baking
// the image in is the fix — but a baked tile is only correct for ONE centre and
// ONE zoom, and the app picks those at run time from the viewport width. Pick
// them differently on the server and the ground no longer lines up with the
// pins drawn on it, which is worse than no map at all.
//
// So there is exactly one implementation. It ships into the generated app as
// its own source (see mapfitJs) and is imported here by the baker, the same
// trick renderer/icons.js uses for the landmark matcher.

/**
 * The centre and zoom that fit every point, with room for its marker.
 *
 * WRITTEN AS ONE PLAIN FUNCTION ON PURPOSE — it is serialised with
 * Function.prototype.toString and spliced into the app. No template literals,
 * no backticks, no dollar-brace, nothing it cannot carry.
 */
export function fitMap(pts, MW, MH, PADX, PADB) {
  var TILE = 256;
  function m(lat, lon, z) {
    var s = TILE * Math.pow(2, z), sl = Math.sin(lat * Math.PI / 180);
    return { x: (lon + 180) / 360 * s, y: (0.5 - Math.log((1 + sl) / (1 - sl)) / (4 * Math.PI)) * s };
  }
  var lats = [], lons = [], i;
  for (i = 0; i < pts.length; i++) { lats.push(pts[i].lat); lons.push(pts[i].lon); }
  if (!lats.length) return { cLat: 0, cLon: 0, z: 12 };
  var cLat = (Math.min.apply(null, lats) + Math.max.apply(null, lats)) / 2;
  var cLon = (Math.min.apply(null, lons) + Math.max.apply(null, lons)) / 2;

  // Widest zoom first, stepping in until everything fits with room for its
  // marker. A single point has no span to fit, so it gets a city zoom.
  var z = 12;
  if (pts.length > 1) {
    for (z = 15; z > 1; z--) {
      var xs = [], ys = [];
      for (i = 0; i < pts.length; i++) {
        var q = m(pts[i].lat, pts[i].lon, z);
        xs.push(q.x); ys.push(q.y);
      }
      if (Math.max.apply(null, xs) - Math.min.apply(null, xs) <= MW - PADX * 2
        && Math.max.apply(null, ys) - Math.min.apply(null, ys) <= MH - PADX - PADB) break;
    }
  }
  return { cLat: cLat, cLon: cLon, z: z };
}

/** The same function, as plain source, for splicing into the generated app. */
export function mapfitJs() {
  // Assigned, never emitted as a bare statement: the production minifier
  // rewrites the export as an anonymous function expression, and a bare
  // "function(...)" is a SyntaxError that takes the whole map script with it.
  // That exact bug shipped once already, on 2026-09-06, from renderer/icons.js.
  return 'var fitMap = ' + fitMap.toString().replace(/^export\s+/, '') + ';\n';
}

// The width the ground is baked for.
//
// The app's own `k` is MW/W and W comes from the viewport, so a phone and a
// desktop can land on different zooms. A baked trip is opened on a phone, so it
// is baked for one: 390px wide, minus the 36px of page padding.
export const BAKE_W = 354;

/** What the app would ask /api/map for, given the trip's points. */
export function groundQuery(pts, w) {
  const MH = 640, MW = 480;
  const k = MW / (w || BAKE_W);
  const PAD = (28 + 14) * k;             // BUB + 14, in map units
  const f = fitMap(pts, MW, MH, PAD, PAD);
  return {
    c: f.cLat.toFixed(5) + ',' + f.cLon.toFixed(5),
    z: f.z,
    w: MW,
    cLat: f.cLat,
    cLon: f.cLon,
  };
}

/** Every point the map has to fit: stays, planned items, and the airport. */
export function mapPoints(it) {
  const num = (v) => (isFinite(+v) ? +v : null);
  const out = [];
  const add = (lat, lon) => {
    const a = num(lat), o = num(lon);
    if (a !== null && o !== null) out.push({ lat: a, lon: o });
  };
  ((it && it.stays) || []).forEach((s) => add(s.lat, s.lon));
  ((it && it.days) || []).forEach((d) => ((d && d.items) || []).forEach((x) => add(x.lat, x.lon)));
  return out;
}
