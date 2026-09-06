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
// A rolling case with a plane flying out of it.
//
// raffy, 2026-09-06, pointing an arrow at the bottom-left corner of his
// reference: "the icon doesn't look clean an no blending like the arrow show.
// like it's not properly designed."
//
// He is right, and the corner is exactly where it shows. In the reference the
// plane does not sit INSIDE the case — its wing breaks out through the case's
// own edge, and that corner scoops away to meet it. The two shapes merge into
// one object. What I drew before was a plane-shaped hole in a rectangle, which
// is a sticker on a box, and no amount of resizing fixes that.
//
// So: the body carries a big sweeping radius on the bottom-left (110 against 40
// everywhere else), and the plane is drawn large enough and low enough that its
// tail wing crosses that edge. The cut-out opens the silhouette rather than
// perforating it, and the ground flows through.
const svg = (px, kind) => {
  const S = 512;

  // FULL BLEED, no corner radius of our own.
  //
  // Both platforms round the icon themselves — iOS to its squircle, Android to
  // whatever the launcher uses — so a tile that arrives pre-rounded gets
  // rounded twice, and the second pass eats into the first.
  const k = kind === 'mask' ? 0.88 : 1.10;
  const ground = `<rect width="${S}" height="${S}" fill="${GREEN}"/>`;

  // The case body. Three ordinary corners and one that sweeps.
  const X0 = 126, Y0 = 176, X1 = 386, Y1 = 436, r = 42, R = 104;
  const BODY = `M${X0 + r} ${Y0}H${X1 - r}A${r} ${r} 0 0 1 ${X1} ${Y0 + r}`
    + `V${Y1 - r}A${r} ${r} 0 0 1 ${X1 - r} ${Y1}`
    + `H${X0 + R}A${R} ${R} 0 0 1 ${X0} ${Y1 - R}`
    + `V${Y0 + r}A${r} ${r} 0 0 1 ${X0 + r} ${Y0}Z`;

  // The plane, in a 24-box, drawn nose-up. Scaled and turned so it climbs to
  // the right and its low wing runs out through the swept corner.
  const PLANE = 'M12 2.5c.9 0 1.6.8 1.6 1.7v5.1l7.4 4.3v2.1l-7.4-2.3v4.7l2.6 1.9v1.6'
    + 'L12 20.5l-4.2 1.1v-1.6l2.6-1.9v-4.7L3 15.7v-2.1l7.4-4.3V4.2c0-.9.7-1.7 1.6-1.7';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${S} ${S}">
  ${ground}
  <defs>
    <mask id="cut">
      <rect width="${S}" height="${S}" fill="#000"/>
      <path d="${BODY}" fill="#fff"/>
      <!-- Black cuts. Sized so the CASE still reads as a case — a plane that
           fills the body is not a case with a plane on it, it is a plane in a
           box. It sits low and left so the tail runs out through the swept
           corner and nowhere else. -->
      <g transform="translate(258 326) rotate(40) scale(8.6) translate(-12 -12)">
        <path d="${PLANE}" fill="#000"/>
      </g>
    </mask>
  </defs>
  <g transform="translate(${S / 2} ${S / 2}) scale(${k}) translate(${-S / 2} -300)">
    <!-- the pull handle -->
    <path d="M198 100h116a20 20 0 0 1 20 20v36h-36v-20h-84v20h-36v-36a20 20 0 0 1 20-20z"
      fill="${CREAM}"/>
    <rect x="216" y="150" width="26" height="34" fill="${CREAM}"/>
    <rect x="270" y="150" width="26" height="34" fill="${CREAM}"/>
    <!-- the case, opened by the plane -->
    <path d="${BODY}" fill="${CREAM}" mask="url(#cut)"/>
    <!-- wheels -->
    <circle cx="196" cy="470" r="27" fill="${CORAL}"/>
    <circle cx="330" cy="470" r="27" fill="${CORAL}"/>
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
  img{display:block;border-radius:23%}</style>
  <figure><img src="data:image/svg+xml;base64,${Buffer.from(svg(48,'full')).toString('base64')}" width="48"><figcaption>48px</figcaption></figure>
  <figure><img src="data:image/svg+xml;base64,${Buffer.from(svg(72,'full')).toString('base64')}" width="72"><figcaption>72px</figcaption></figure>
  <figure><img src="data:image/svg+xml;base64,${Buffer.from(svg(112,'full')).toString('base64')}" width="112"><figcaption>112px home screen</figcaption></figure>
  <figure><img src="data:image/svg+xml;base64,${Buffer.from(svg(112,'mask')).toString('base64')}" width="112" style="border-radius:50%"><figcaption>maskable, circle crop</figcaption></figure>`,
  { waitUntil: 'load' });
await page.screenshot({ path: 'shots/icon-sizes.png' });
await browser.close();
