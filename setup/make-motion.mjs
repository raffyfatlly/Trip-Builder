// A short motion graphic for the tester post.
//
// raffy, 2026-09-08: "create a motion graphic video ... using the tell it where
// you going, it plans the day properly etc etc and the whole trip becomes an
// app photos. nice sequence."
//
// Drawn and recorded here rather than generated. A video model animating a
// screenshot re-imagines what it cannot read: the UI text warps, the prices
// change, the app in the video stops being the app. For a sequence whose whole
// job is showing four real screens in order, a deterministic render is not the
// cheap option, it is the accurate one.
//
// Frame-accurate by construction: nothing is a CSS animation. A render(t)
// function positions everything for a given moment, the page is stepped one
// frame at a time, and each step is a screenshot. So the file is identical
// every run and any beat can be retimed by changing one number.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';

// ffmpeg is not on this box and cannot be installed from the usual places, but
// @ffmpeg-installer ships a static binary INSIDE the npm package, and the npm
// registry is reachable. `npm i @ffmpeg-installer/ffmpeg` and this resolves.
const FF = (await import('@ffmpeg-installer/ffmpeg')).default.path;
const OUT = process.env.FRAMES || '/tmp/tb-frames';
const W = 1080, H = 1920, FPS = 30;

const font = (f) => 'data:font/woff2;base64,' + fs.readFileSync('public/' + f).toString('base64');
const shot = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');

// Four beats and an end card. The lines are the ones already on the still
// images, so the video and the pictures say the same thing.
const BEATS = [
  { img: 'public/welcome/chat-cards.png', line: 'Tell it where you’re going.',        sub: 'It goes and finds real places, with real prices.' },
  { img: 'public/welcome/days.png',       line: 'It plans the days properly.',        sub: 'Opening times, drive times, what is shut on a Tuesday.' },
  { img: 'shots/app-trip.png',            line: 'The whole trip becomes an app.',     sub: 'On your phone. Works with no internet.' },
  { img: 'shots/app-todo.png',            line: 'It remembers what you have to book.',sub: 'And by when, so nothing sells out on you.' },
];
const BEAT = 2.7, END = 3.0;
const DUR = BEATS.length * BEAT + END;

const html = `<style>
  @font-face{font-family:'Outfit';font-weight:100 900;src:url(${font('outfit.woff2')}) format('woff2')}
  @font-face{font-family:'Jakarta';font-weight:200 800;src:url(${font('jakarta.woff2')}) format('woff2')}
  html,body{margin:0;padding:0;background:#F1F4EF}
  .c{width:${W}px;height:${H}px;position:relative;overflow:hidden;background:#F1F4EF;
     font-family:'Jakarta',system-ui,sans-serif}
  .warm{position:absolute;inset:0;
        background:radial-gradient(115% 46% at 50% 96%, rgba(233,116,58,.24), rgba(233,116,58,0) 62%)}
  .beat{position:absolute;inset:0;opacity:0}
  .cap{position:absolute;left:84px;right:84px;top:150px}
  .cap h1{font-family:'Outfit',sans-serif;font-weight:800;font-size:76px;line-height:1.06;
          letter-spacing:-.035em;color:#12352A;margin:0}
  .cap p{margin:20px 0 0;font-size:30px;line-height:1.45;color:#4A6155;max-width:840px}
  .ph{position:absolute;left:50%;top:520px;width:520px;margin-left:-260px;
      border-radius:40px;overflow:hidden;background:#0E2E23;
      box-shadow:0 34px 70px rgba(18,53,42,.26), 0 0 0 1px rgba(18,53,42,.10)}
  .ph img{width:100%;display:block}
  /* the end card */
  .end{position:absolute;inset:0;opacity:0;display:flex;flex-direction:column;
       align-items:center;justify-content:center;text-align:center;padding:0 90px}
  .end .eye{font-family:'Outfit',sans-serif;font-weight:800;font-size:24px;letter-spacing:.18em;
            text-transform:uppercase;color:#C25A2A;margin:0 0 26px}
  .end h1{font-family:'Outfit',sans-serif;font-weight:800;font-size:88px;line-height:1.04;
          letter-spacing:-.035em;color:#12352A;margin:0}
  .end .u{margin:44px 0 0;font-family:'Outfit',sans-serif;font-weight:800;font-size:40px;
          color:#C25A2A;letter-spacing:-.015em}
  .end .n{margin:16px 0 0;font-size:28px;color:#4A6155}
</style>
<div class="c" id="c"><div class="warm"></div>
  ${BEATS.map((b, i) => `<div class="beat" id="b${i}">
      <div class="cap"><h1>${b.line}</h1><p>${b.sub}</p></div>
      <div class="ph"><img src="${shot(b.img)}"></div>
    </div>`).join('')}
  <div class="end" id="end">
    <p class="eye">Looking for testers</p>
    <h1>Anyone planning a trip?</h1>
    <p class="u">trip-builder-two.vercel.app</p>
    <p class="n">Free to try. Tell me what breaks.</p>
  </div>
</div>
<script>
  // Everything about the motion lives here, in one function of time.
  var BEAT = ${BEAT}, N = ${BEATS.length}, END = ${END};
  var out = function(x){ return 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3); };
  var clamp = function(x){ return Math.min(1, Math.max(0, x)); };
  window.render = function(t){
    for (var i = 0; i < N; i++) {
      var el = document.getElementById('b' + i);
      var local = t - i * BEAT;            // seconds since this beat began
      var cap = el.querySelector('.cap'), ph = el.querySelector('.ph');
      if (local < -0.35 || local > BEAT + 0.35) { el.style.opacity = 0; continue; }
      // In over the first .55s, out over the last .45s. They overlap slightly,
      // so one beat is handing over to the next rather than blinking.
      var vin = out(clamp(local / 0.55));
      var vout = 1 - clamp((local - (BEAT - 0.45)) / 0.45);
      el.style.opacity = Math.min(vin, vout);
      // The phone rises into place and keeps drifting up a hair while it holds,
      // which is what stops a still image reading as a still image.
      var rise = (1 - vin) * 90 - Math.max(0, local) * 6;
      ph.style.transform = 'translateY(' + rise + 'px) scale(' + (0.985 + 0.015 * vin) + ')';
      // The words follow the picture by a beat of their own.
      var cv = out(clamp((local - 0.12) / 0.5));
      cap.style.transform = 'translateY(' + ((1 - cv) * 26) + 'px)';
      cap.style.opacity = cv;
    }
    var e = document.getElementById('end');
    var le = t - N * BEAT;
    if (le < -0.4) { e.style.opacity = 0; }
    else {
      var ev = out(clamp((le + 0.4) / 0.7));
      e.style.opacity = ev;
      e.style.transform = 'translateY(' + ((1 - ev) * 22) + 'px)';
    }
  };
</script>`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.waitForTimeout(600);

const total = Math.round(DUR * FPS);
for (let f = 0; f < total; f++) {
  await page.evaluate((t) => window.render(t), f / FPS);
  await page.screenshot({ path: `${OUT}/f${String(f).padStart(4, '0')}.png` });
}
await browser.close();
console.log('frames:', total);

// yuv420p and an even frame size, or half the players in the world show a green
// smear instead of a video.
execFileSync(FF, ['-y', '-framerate', String(FPS), '-i', `${OUT}/f%04d.png`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  'shots/trip-builder.mp4'], { stdio: 'inherit' });
console.log('shots/trip-builder.mp4');
