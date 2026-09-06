// The app icon, drawn once and rasterised to PNG.
//
// SVG cannot be used: Android mints a real installed app (a WebAPK) only from a
// raster icon, and with an SVG it falls back to a browser shortcut — which is
// what puts the little Chrome badge on the corner. raffy, 2026-09-06: "remove
// the chrome thingy attached to it".
//
// The mark is the app's own motif: the dashed journey curve from the trip map,
// with a coral waypoint at the end of it.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';

const GREEN = '#10362A';
const CORAL = '#EE7B45';
const CREAM = '#EAF2EC';

// full: the mark sized for a normal icon, with its own rounded-square ground.
// mask: the same mark shrunk into the safe circle, on a full-bleed ground,
//       because Android crops a maskable icon to whatever shape the launcher
//       uses and anything outside the middle 80% can be cut off.
// A rolling case with a plane cut out of it, in the app's own colours.
//
// raffy, 2026-09-06, with a reference: "make the app logo to be more something
// like this, but change to my color like what u did. adjust the sizing too."
//
// His reference is a solid case with the plane as NEGATIVE SPACE — the tile
// shows through it. That is what makes it read at 48px: one silhouette and one
// hole, rather than several thin strokes competing. The journey-curve mark it
// replaces was drawn in strokes and went muddy at launcher size.
//
// Cream case on the deep green, and the one coral accent on the wheels, which
// is where the eye lands last and where the app puts coral everywhere else.
const svg = (px, kind) => {
  const S = 512;
  const k = kind === 'mask' ? 0.76 : 1;
  const ground = kind === 'mask'
    ? `<rect width="${S}" height="${S}" fill="${GREEN}"/>`
    : `<rect width="${S}" height="${S}" rx="112" fill="${GREEN}"/>`;

  // The plane, knocked out of the case. Drawn in a 24-box, then scaled and
  // turned so it climbs to the right the way the reference's does.
  const PLANE = 'M12 2.5c.9 0 1.6.8 1.6 1.7v5.1l7.4 4.3v2.1l-7.4-2.3v4.7l2.6 1.9v1.6'
    + 'L12 20.5l-4.2 1.1v-1.6l2.6-1.9v-4.7L3 15.7v-2.1l7.4-4.3V4.2c0-.9.7-1.7 1.6-1.7';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${S} ${S}">
  ${ground}
  <defs>
    <mask id="cut">
      <rect width="${S}" height="${S}" fill="#000"/>
      <!-- white keeps, black cuts -->
      <rect x="126" y="176" width="260" height="258" rx="40" fill="#fff"/>
      <g transform="translate(256 305) rotate(38) scale(8.4) translate(-12 -12)">
        <path d="${PLANE}" fill="#000"/>
      </g>
    </mask>
  </defs>
  <!-- The mark's own bounding box is x 126-386, y 104-488, so its centre sits
       at (256, 296) — forty pixels below the tile's. Drawn as-is it hung low
       and the wheels touched the edge; under a circle crop they were cut off
       entirely. This maps that box to the middle of the tile with room around
       it, which is the "adjust the sizing too" part. -->
  <g transform="translate(${S / 2} ${S / 2}) scale(${k * 0.885}) translate(${-S / 2} -296)">
    <!-- the pull handle: a bar and two posts, the shape that says luggage -->
    <path d="M196 104h120a18 18 0 0 1 18 18v34h-34v-18h-88v18h-34v-34a18 18 0 0 1 18-18z"
      fill="${CREAM}"/>
    <rect x="214" y="150" width="24" height="34" fill="${CREAM}"/>
    <rect x="274" y="150" width="24" height="34" fill="${CREAM}"/>
    <!-- the case, with the plane taken out of it -->
    <rect x="126" y="176" width="260" height="258" rx="40" fill="${CREAM}" mask="url(#cut)"/>
    <!-- wheels, and the one place coral gets to be -->
    <circle cx="186" cy="462" r="26" fill="${CORAL}"/>
    <circle cx="326" cy="462" r="26" fill="${CORAL}"/>
  </g>
</svg>`;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
for (const [name, px, kind] of [
  ['icon-192.png', 192, 'full'], ['icon-512.png', 512, 'full'],
  ['icon-maskable-512.png', 512, 'mask'],
]) {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}</style>` + svg(px, kind),
    { waitUntil: 'load' },
  );
  const buf = await page.locator('svg').screenshot({ omitBackground: true });
  fs.writeFileSync('public/' + name, buf);
  console.log(name, (buf.length / 1024).toFixed(1) + 'KB');
}

// A contact sheet at the sizes a phone actually shows it.
await page.setViewportSize({ width: 620, height: 260 });
await page.setContent(`<style>body{margin:0;background:#EDF2EA;font-family:system-ui;
  display:flex;gap:26px;align-items:flex-end;padding:34px}
  figure{margin:0;text-align:center}figcaption{font-size:10px;color:#4C6157;margin-top:7px;font-weight:600}
  img{display:block;border-radius:22%}</style>
  <figure><img src="data:image/svg+xml;base64,${Buffer.from(svg(48,'full')).toString('base64')}" width="48"><figcaption>48px</figcaption></figure>
  <figure><img src="data:image/svg+xml;base64,${Buffer.from(svg(72,'full')).toString('base64')}" width="72"><figcaption>72px</figcaption></figure>
  <figure><img src="data:image/svg+xml;base64,${Buffer.from(svg(112,'full')).toString('base64')}" width="112"><figcaption>112px home screen</figcaption></figure>
  <figure><img src="data:image/svg+xml;base64,${Buffer.from(svg(112,'mask')).toString('base64')}" width="112" style="border-radius:50%"><figcaption>maskable, circle crop</figcaption></figure>`,
  { waitUntil: 'load' });
await page.screenshot({ path: 'shots/icon-sizes.png' });
await browser.close();
