// One image, all four screens, for the Facebook post.
//
// raffy, 2026-09-08: "I mean all of the green photo but in one image. just one
// image. use chatgpt. but make it nice. and not too depressing."
//
// Two things in that. The four separate cards become ONE picture, and the dark
// green goes: it was the app's darkest colour used at full bleed four times
// over, which is handsome on a website and heavy in a feed. So this is the
// app's PAPER instead — the warm off-white every screen actually sits on — with
// the green kept for type and the coral doing the warming. Same brand, opposite
// weight.
//
// Drawn here rather than generated. A generator would have to re-draw four
// screenshots and a headline it cannot spell reliably, and this composition is
// a layout problem, not an imagination problem.
//
//   node setup/shot-poster.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';

const font = (f) => 'data:font/woff2;base64,' + fs.readFileSync('public/' + f).toString('base64');
const shot = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');

const W = 1080, H = 1350;

// The four screens, in the order somebody meets them.
const SCREENS = [
  'public/welcome/chat-cards.png',
  'public/welcome/days.png',
  'shots/app-trip.png',
  'shots/app-todo.png',
];

// What each one does, said in three words. As a single line under the headline
// rather than a label per phone: four captions at four angles is four things to
// read before you have looked at anything.
const DOES = ['Finds the places', 'Plans the days', 'Tracks the bookings', 'Yours to keep'];

// A gentle fan, sized so all four FIT. The first attempt spread them 340px
// apart and pushed the outer two half off the canvas, which does not read as a
// deliberate bleed — it reads as a mistake. They overlap instead, like a stack
// somebody spread out on a table, and only the bottom edge runs off.
// Rotation costs width at the bottom of a tall element — about sin(angle) x
// height of sideways travel — which is what pushed the outer two off the canvas
// on the first two attempts. Small angles, and the pivot moved down into the
// phone so the swing is shared between top and bottom instead of all at the
// foot.
const PW = 316;
const LAY = [
  { x: 26,  y: 92, r: -4.5, z: 1 },
  { x: 262, y: 40, r: -1.5, z: 2 },
  { x: 498, y: 22, r:  1.5, z: 4 },
  { x: 734, y: 70, r:  4.5, z: 3 },
];

const html = `<style>
  @font-face{font-family:'Outfit';font-weight:100 900;src:url(${font('outfit.woff2')}) format('woff2')}
  @font-face{font-family:'Jakarta';font-weight:200 800;src:url(${font('jakarta.woff2')}) format('woff2')}
  html,body{margin:0;padding:0}
  .c{width:${W}px;height:${H}px;position:relative;overflow:hidden;
     font-family:'Jakarta',system-ui,sans-serif;background:#F1F4EF}
  /* Warmth, not decoration: a low coral wash so the phones sit in light rather
     than on a flat sheet. */
  .warm{position:absolute;inset:0;
        background:
          radial-gradient(120% 66% at 50% 104%, rgba(233,116,58,.22), rgba(233,116,58,0) 60%),
          radial-gradient(90% 55% at 10% -12%, rgba(16,54,42,.10), rgba(16,54,42,0) 60%)}
  .t{position:absolute;left:74px;right:74px;top:70px}
  .eyebrow{font-family:'Outfit',sans-serif;font-weight:800;font-size:19px;letter-spacing:.17em;
           text-transform:uppercase;color:#C25A2A;margin:0 0 16px}
  h1{font-family:'Outfit',sans-serif;font-weight:800;font-size:72px;line-height:1.04;
     letter-spacing:-.035em;color:#12352A;margin:0}
  .sub{margin:18px 0 0;font-size:28px;line-height:1.48;color:#4A6155;max-width:800px}
  .does{margin:26px 0 0;display:flex;flex-wrap:wrap;gap:10px}
  .does span{font-family:'Outfit',sans-serif;font-weight:750;font-size:19px;color:#2C4C3F;
             background:#DFE8DE;border-radius:999px;padding:9px 17px;letter-spacing:-.01em}
  .url{position:absolute;left:74px;top:404px;font-family:'Outfit',sans-serif;font-weight:800;
       font-size:25px;color:#C25A2A;letter-spacing:-.01em}
  .fan{position:absolute;left:0;right:0;top:486px;height:940px}
  .p{position:absolute;width:${PW}px;transform-origin:50% 42%;border-radius:28px;overflow:hidden;
     background:#0E2E23;
     box-shadow:0 26px 54px rgba(18,53,42,.24), 0 0 0 1px rgba(18,53,42,.10)}
  .p img{width:100%;display:block}
</style>
<div class="c"><div class="warm"></div>
  <div class="t">
    <p class="eyebrow">Looking for testers</p>
    <h1>Anyone planning a trip?</h1>
    <p class="sub">I built something that plans it with you, then turns the whole thing into an app on your phone.</p>
    <div class="does">${DOES.map((d) => `<span>${d}</span>`).join('')}</div>
  </div>
  <div class="url">trip-builder-two.vercel.app</div>
  <div class="fan">
    ${SCREENS.map((f, i) => `<div class="p" style="left:${LAY[i].x}px;top:${LAY[i].y}px;
        transform:rotate(${LAY[i].r}deg);z-index:${LAY[i].z}"><img src="${shot(f)}"></div>`).join('')}
  </div>
</div>`;

const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: W, height: H } });
await p.setContent(html);
await p.waitForTimeout(500);
await p.screenshot({ path: 'shots/social-poster.png' });
await browser.close();
console.log('shots/social-poster.png');
