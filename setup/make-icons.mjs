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
const svg = (px, kind) => {
  const S = 512;
  // Scaled about the CENTRE, not inset from the corner: a maskable icon is
  // cropped to whatever shape the launcher uses, so the mark has to sit in the
  // middle 80% — but inset-from-corner also pushed it off-centre and left the
  // safe circle half empty.
  const k = kind === 'mask' ? 0.78 : 1;
  const ground = kind === 'mask'
    ? `<rect width="${S}" height="${S}" fill="${GREEN}"/>`
    : `<rect width="${S}" height="${S}" rx="112" fill="${GREEN}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${S} ${S}">
  ${ground}
  <g transform="translate(${S / 2} ${S / 2}) scale(${k}) translate(${-S / 2} ${-S / 2})">
    <!-- The journey: one curve, drawn the way the map draws it. -->
    <path d="M132 372 C 150 268, 214 214, 268 196 C 330 176, 372 214, 380 160"
      fill="none" stroke="${CREAM}" stroke-width="26" stroke-linecap="round"
      stroke-dasharray="4 46" opacity=".92"/>
    <!-- Where they start: a quiet filled dot. -->
    <circle cx="132" cy="372" r="30" fill="${CREAM}"/>
    <!-- Where they are going: the coral waypoint, the app's one accent. -->
    <circle cx="380" cy="160" r="52" fill="${GREEN}" stroke="${CORAL}" stroke-width="26"/>
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
