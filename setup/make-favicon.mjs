// The favicon, from the same artwork as the app icon.
//
// raffy, 2026-09-08: "get nice favicon for my url". There was none at all — the
// tab showed the browser's default globe on both the app and the landing page.
//
// WHY IT IS NOT SIMPLY THE APP ICON SHRUNK.
//
// setup/icon-source.png is his artwork: a case with the plane cut out of it, a
// handle above and two coral wheels below. At 192px that reads beautifully. At
// 16px — which is the size a browser tab actually draws — it does not: measured
// side by side, the handle collapses into two grey specks, the wheels into two
// orange ones, and the case turns into a white blob with something smudged on
// it. A favicon has about 250 pixels to say what an app is.
//
// So the favicon is the SAME artwork, cropped to the part that survives: the
// case body with the plane cut through it. Nothing is redrawn and nothing is
// invented — the handle and the wheels are simply outside the crop, the way a
// logo drops its wordmark at small sizes. The identity people recognise, the
// plane-shaped hole, is what is left.
//
// The Apple touch icon is the opposite case: it is drawn at 180px on a home
// screen, right next to the installed app, so it uses the FULL mark and matches
// icon-192.png exactly. Two sizes, two crops, one piece of art.
//
//   node setup/make-favicon.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';

const GREEN = '#10362A';
const MARK = 'data:image/png;base64,' + fs.readFileSync('setup/icon-source.png').toString('base64');

// The artwork, and where the case body sits inside it. Measured off the alpha
// channel rather than guessed: rows 203 to 679 are the ones that run the full
// width of the file, which is the case; above them is the handle, below the
// wheels.
const ART = { w: 390, h: 750, caseTop: 203, caseBottom: 679 };
const CASE_H = ART.caseBottom - ART.caseTop;

// How much of the tile the mark fills.
//   case: 0.86 — enough green around it that the tab's own background does not
//     touch the white, which is what makes it read as a mark rather than a
//     blob.
//   full: 0.88, the proportion in his file, same as the app icon.
const FILL = { case: 0.86, full: 0.88 };

const tile = (px, kind) => {
  if (kind === 'full') {
    return `<style>html,body{margin:0}
      .t{width:${px}px;height:${px}px;background:${GREEN};display:flex;
         align-items:center;justify-content:center;overflow:hidden}
      .t img{height:${px * FILL.full}px;width:auto;display:block}
    </style><div class="t"><img src="${MARK}"></div>`;
  }
  // Cropping in the page rather than in an image library: the box is the case's
  // own aspect and the artwork is slid up inside it, so there is one source
  // file and no second copy to fall out of step with it.
  const k = (px * FILL.case) / CASE_H;
  return `<style>html,body{margin:0}
    .t{width:${px}px;height:${px}px;background:${GREEN};display:flex;
       align-items:center;justify-content:center;overflow:hidden}
    .c{width:${ART.w * k}px;height:${CASE_H * k}px;overflow:hidden;position:relative}
    .c img{position:absolute;left:0;top:${-ART.caseTop * k}px;
           width:${ART.w * k}px;height:${ART.h * k}px;display:block}
  </style><div class="t"><div class="c"><img src="${MARK}"></div></div>`;
};

const browser = await chromium.launch();
const page = await browser.newPage();
const shot = async (px, kind) => {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(tile(px, kind));
  await page.waitForTimeout(120);
  return page.screenshot();
};

// A browser asks for /favicon.ico whether you link one or not, so shipping a
// real one is what stops the 404 and the default globe. PNG-inside-ICO is
// understood by every browser that is still shipping, and keeps the file at a
// few KB instead of the bitmap format's tens.
const pngs = [];
for (const px of [16, 32, 48]) pngs.push([px, await shot(px, 'case')]);
const ico = (entries) => {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = [], body = [];
  for (const [px, buf] of entries) {
    const e = Buffer.alloc(16);
    e.writeUInt8(px >= 256 ? 0 : px, 0);   // 0 means 256 in this format
    e.writeUInt8(px >= 256 ? 0 : px, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12);
    offset += buf.length;
    dir.push(e); body.push(buf);
  }
  return Buffer.concat([head, ...dir, ...body]);
};
fs.writeFileSync('public/favicon.ico', ico(pngs));

// And the modern pair beside it: browsers that prefer a PNG take the 32, and
// iOS takes the 180 for a home-screen shortcut.
fs.writeFileSync('public/favicon-32.png', pngs[1][1]);
fs.writeFileSync('public/apple-touch-icon.png', await shot(180, 'full'));

await browser.close();
for (const f of ['favicon.ico', 'favicon-32.png', 'apple-touch-icon.png']) {
  console.log(f.padEnd(22), fs.statSync('public/' + f).size, 'bytes');
}
