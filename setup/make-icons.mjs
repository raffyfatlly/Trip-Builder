// The app icon, composited from raffy's own artwork and rasterised to PNG.
//
// SVG cannot be used: Android mints a real installed app (a WebAPK) only from a
// raster icon, and with an SVG it falls back to a browser shortcut — which is
// what puts the little Chrome badge on the corner. raffy, 2026-09-06: "remove
// the chrome thingy attached to it".
//
// WHY THIS IS NO LONGER A DRAWING.
//
// I drew this mark three times — a journey curve, a case with a plane on it, a
// case with a plane cut through its corner — and raffy rejected each one, the
// last with an arrow pointing at the corner: "the icon doesn't look clean an no
// blending like the arrow show. like it's not properly designed what u did
// last." Then he sent the artwork he actually wanted and said "use this image
// for the generated app icon".
//
// So the mark is his file, not my geometry. `setup/icon-source.png` is that
// image with the green field keyed out to transparency, which does two things
// at once: it lets the mark sit on the app's exact brand green rather than the
// slightly different green it was drawn on, and — because the plane is a
// CUT-OUT rather than a shape — the plane comes through as a hole, so it stays
// the same colour as the ground no matter what the ground is. Keying was done
// by projecting every pixel onto the line between the source green and the
// nearest foreground colour, so the soft edges keep their blend instead of
// turning into a jagged mask.
//
// Nothing here draws. If the mark ever changes, replace icon-source.png.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';

const GREEN = '#10362A';
const MARK = 'data:image/png;base64,' + fs.readFileSync('setup/icon-source.png').toString('base64');

// How much of the tile's height the mark takes.
//
// full: 88%, the proportion in raffy's own file — which is the answer to
//   "bigger inner size for app icon. mean not too much background", so copying
//   it is the whole point. I first cut this to 78% believing the launcher's
//   rounded corner was clipping the wheels; measured against a real 22.5% mask
//   at 112px and 192px it loses ZERO pixels at 88%, so the reduction was
//   protecting against nothing and only made the mark smaller than he asked.
// mask: 68%. This one is real. Android crops a maskable icon to whatever shape
//   the launcher uses, and a CIRCLE crop of a mark this tall takes the handle
//   off the top and the wheels off the bottom long before a squircle would.
const FILL = { full: 0.88, mask: 0.68 };

const html = (px, kind) => `<style>
  html,body{margin:0;padding:0}
  .tile{width:${px}px;height:${px}px;background:${GREEN};
        display:flex;align-items:center;justify-content:center;overflow:hidden}
  /* Height-driven: the mark is much taller than it is wide, so fixing the
     height is what controls how big it reads. Width follows on its own. */
  .tile img{height:${Math.round(px * FILL[kind])}px;width:auto;display:block}
</style><div class="tile"><img src="${MARK}"></div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
for (const [name, px, kind] of [
  ['icon-192.png', 192, 'full'], ['icon-512.png', 512, 'full'],
  ['icon-maskable-512.png', 512, 'mask'],
]) {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(html(px, kind), { waitUntil: 'load' });
  const buf = await page.locator('.tile').screenshot();
  fs.writeFileSync('public/' + name, buf);
  console.log(name, (buf.length / 1024).toFixed(1) + 'KB');
}

// A contact sheet at the sizes a phone actually shows it, including the circle
// crop — the one view that proves the maskable variant is not being clipped.
await page.setViewportSize({ width: 640, height: 260 });
const cell = (px, kind, round) => `<figure><div style="width:${px}px;height:${px}px;
  background:${GREEN};border-radius:${round};overflow:hidden;display:flex;
  align-items:center;justify-content:center">
  <img src="${MARK}" style="height:${Math.round(px * FILL[kind])}px;width:auto;display:block">
  </div><figcaption>${kind === 'mask' ? 'maskable, circle crop' : px + 'px'}</figcaption></figure>`;
await page.setContent(`<style>body{margin:0;background:#EDF2EA;font-family:system-ui;
  display:flex;gap:26px;align-items:flex-end;padding:34px}
  figure{margin:0;text-align:center}
  figcaption{font-size:10px;color:#4C6157;margin-top:7px;font-weight:600}</style>
  ${cell(48, 'full', '23%')}${cell(72, 'full', '23%')}${cell(112, 'full', '23%')}${cell(112, 'mask', '50%')}`,
  { waitUntil: 'load' });
fs.mkdirSync('shots', { recursive: true });
await page.screenshot({ path: 'shots/icon-sizes.png' });
await browser.close();
