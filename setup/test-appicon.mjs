// The app icon, checked as pixels rather than by eye.
//
// I got this wrong twice in a way that only showed up in a screenshot: the mark
// filled so much of the tile that the squircle every phone applies cut straight
// through the wheels. The generator was "correct" both times — the source file
// really did fill 88% of its own height — because the source is a flat square
// and a home screen is not. Nothing in the repo could catch that, so raffy did.
//
// These read the actual PNGs and assert the geometry that matters on a phone:
// the ground is fully painted, the mark clears the corner the launcher rounds
// off, the maskable variant survives a circle crop, and the plane is still a
// HOLE in the case rather than a shape painted on it — which is what "blending"
// meant when he asked for it.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';

const GREEN = [16, 54, 42];
let fail = 0;
const ok = (what, cond, extra) => {
  console.log((cond ? '  ok  ' : '  FAIL ') + what + (cond || !extra ? '' : '  — ' + extra));
  if (!cond) fail++;
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');

// Pull one icon into a canvas and answer every geometric question about it in
// one pass, because each round trip has to re-decode the PNG.
async function measure(file) {
  const data = 'data:image/png;base64,' + fs.readFileSync('public/' + file).toString('base64');
  return page.evaluate(async ({ data, GREEN }) => {
    const img = new Image();
    img.src = data;
    await img.decode();
    const c = document.getElementById('c');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const S = c.width;
    const near = (i, rgb, tol) => Math.abs(px[i] - rgb[0]) <= tol
      && Math.abs(px[i + 1] - rgb[1]) <= tol && Math.abs(px[i + 2] - rgb[2]) <= tol;

    const out = {
      w: img.width, h: img.height, transparent: 0,
      // How far the mark reaches, as a fraction of the tile, from each edge and
      // from the centre.
      margin: 1, radius: 0, ground: 0, mark: 0, clipped: 0,
    };
    // The actual shape a launcher cuts: a rounded square at ~22% radius, which
    // is what iOS's squircle and Android's default mask both approximate. A
    // plain edge margin is not enough — the wheels sat 6% from the bottom and
    // were still eaten, because near a corner the curve reaches much further in.
    const R = S * 0.22;
    const outside = (x, y) => {
      const dx = x < R ? R - x : (x > S - 1 - R ? x - (S - 1 - R) : 0);
      const dy = y < R ? R - y : (y > S - 1 - R ? y - (S - 1 - R) : 0);
      return Math.hypot(dx, dy) > R;
    };
    let minX = S, maxX = -1, minY = S, maxY = -1, far = 0;
    const cx = (S - 1) / 2, cy = (S - 1) / 2;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        if (px[i + 3] < 250) out.transparent++;
        if (near(i, GREEN, 6)) { out.ground++; continue; }
        out.mark++;
        if (outside(x, y)) out.clipped++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        const d = Math.hypot(x - cx, y - cy);
        if (d > far) far = d;
      }
    }
    out.margin = Math.min(minX, minY, S - 1 - maxX, S - 1 - maxY) / S;
    out.radius = far / S;
    // The plane is a cut-out, so somewhere inside the case's own bounding box
    // there must be a run of ground-coloured pixels. If the plane were painted
    // on instead, the interior would be solid cream.
    let holes = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (near((y * S + x) * 4, GREEN, 6)) holes++;
      }
    }
    out.interiorGround = holes / Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
    return out;
  }, { data, GREEN });
}

console.log('\nThe tiles are what a launcher expects');
for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512]]) {
  const m = await measure(file);
  ok(file + ' is ' + size + '×' + size, m.w === size && m.h === size, m.w + '×' + m.h);
  // A tile with holes in it renders as whatever is behind it — white on one
  // launcher, black on another. It must be painted edge to edge.
  ok('  fully painted, no transparent pixels', m.transparent === 0, m.transparent + ' clear px');
  ok('  on the brand green', m.ground / (m.w * m.h) > 0.4,
    Math.round(100 * m.ground / (m.w * m.h)) + '% ground');
}

console.log('\nThe mark survives the shapes phones cut it to');
{
  // Both platforms round the tile. iOS's squircle and Android's rounded square
  // both bite roughly the outer 6%; anything closer to the edge than that gets
  // shaved. This is the check that would have caught the clipped wheels.
  for (const file of ['icon-192.png', 'icon-512.png']) {
    const m = await measure(file);
    ok(file + ' loses nothing to the rounded corner', m.clipped === 0,
      m.clipped + ' px of the mark fall outside a 22% squircle'
        + ' (mark reaches ' + (100 * m.margin).toFixed(1) + '% from the edge)');
  }
  // A maskable icon can be cropped to a circle. The safe zone is the middle
  // 80% — radius 0.4 of the tile — and every pixel of the mark has to be inside
  // it or the launcher takes the handle or the wheels off.
  const m = await measure('icon-maskable-512.png');
  ok('icon-maskable-512.png fits the safe circle', m.radius <= 0.4,
    'mark reaches radius ' + m.radius.toFixed(3) + ' of 0.400');
}

console.log('\nThe plane is cut out of the case, not stuck on it');
{
  // raffy, 2026-09-06, with an arrow on the reference: "the icon doesn't look
  // clean an no blending". The plane reading as the same colour as the ground
  // IS the blending — it means the case is open, not decorated.
  const m = await measure('icon-512.png');
  ok('there is ground showing through inside the mark', m.interiorGround > 0.08,
    (100 * m.interiorGround).toFixed(1) + '% of the mark box is ground');
}

await browser.close();
console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
