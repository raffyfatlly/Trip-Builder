// Pictures for a Facebook post looking for testers.
//
// raffy, 2026-09-08: "I need few images, like demonstration of the app. I'm
// about to post on fb looking for people to try and test. prototype. but make
// it enticing to normal ppl. something like who's planning a trip etc etc.
// simple words. like me. not like ads."
//
// So: REAL SCREENS, not mockups. Every picture here is the actual app rendered
// at phone size — two of them from a real session he ran (public/welcome/*.png,
// the Desaru trip), two from the renderer running a real trip file. Nothing is
// drawn to look better than it is, because the people who answer this post are
// going to open the thing five minutes later.
//
// And no advertising furniture: no logo lockup, no "AI-powered", no five-star
// row, no call to action stamped across a photo. One short line in his own
// words, then the screen it is talking about. The line is set big because that
// is what a phone-sized screenshot needs to survive a feed, not because it is
// shouting.
//
//   node setup/shots-social.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';

const font = (f) => 'data:font/woff2;base64,' + fs.readFileSync('public/' + f).toString('base64');
const shot = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');

const GREEN = '#0E2E23';
const W = 1080, H = 1350;         // 4:5, the tallest a feed will show uncropped

// The set. Four screens, in the order somebody would meet them.
//
// Captions are the plainest sentence that is true. "Tell it what you want" is
// what the app does; "AI travel concierge" is what a brochure says.
const CARDS = [
  {
    file: 'social-1-ask.png',
    line: 'Tell it where you’re going.',
    sub: 'It goes and finds real places, with real prices.',
    img: 'public/welcome/chat-cards.png',
  },
  {
    file: 'social-2-days.png',
    line: 'It plans the days properly.',
    sub: 'Opening times, drive times, and what is closed on a Tuesday.',
    img: 'public/welcome/days.png',
  },
  {
    file: 'social-3-app.png',
    line: 'Then the whole trip becomes an app.',
    sub: 'On your phone. Works with no internet.',
    img: 'shots/app-trip.png',
  },
  {
    file: 'social-4-todo.png',
    line: 'It remembers what you still have to book.',
    sub: 'And by when, so nothing sells out on you.',
    img: 'shots/app-todo.png',
  },
];

const page = (c) => `<style>
  @font-face{font-family:'Outfit';font-weight:100 900;src:url(${font('outfit.woff2')}) format('woff2')}
  @font-face{font-family:'Jakarta';font-weight:200 800;src:url(${font('jakarta.woff2')}) format('woff2')}
  html,body{margin:0;padding:0}
  .c{width:${W}px;height:${H}px;background:${GREEN};position:relative;overflow:hidden;
     font-family:'Jakarta',system-ui,sans-serif}
  /* A little light behind the phone so the picture is not a rectangle on a
     flat field. Nothing that reads as a graphic in its own right. */
  .glow{position:absolute;left:50%;top:340px;width:1200px;height:1200px;transform:translateX(-50%);
        background:radial-gradient(closest-side,rgba(240,120,60,.20),rgba(240,120,60,0) 70%)}
  .t{position:absolute;left:76px;top:78px;right:76px}
  .t h1{font-family:'Outfit',sans-serif;font-weight:800;font-size:66px;line-height:1.1;
        letter-spacing:-.03em;color:#F7FAF7;margin:0}
  .t p{margin:18px 0 0;font-size:30px;line-height:1.45;color:#A9C0B4;max-width:820px}
  .ph{position:absolute;left:50%;top:328px;transform:translateX(-50%);
      width:566px;border-radius:44px;overflow:hidden;
      box-shadow:0 40px 90px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.10)}
  .ph img{width:100%;display:block}
</style>
<div class="c"><div class="glow"></div>
  <div class="t"><h1>${c.line}</h1><p>${c.sub}</p></div>
  <div class="ph"><img src="${shot(c.img)}"></div>
</div>`;

const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: W, height: H } });
for (const c of CARDS) {
  await p.setContent(page(c));
  await p.waitForTimeout(400);
  await p.screenshot({ path: 'shots/' + c.file });
  console.log(c.file.padEnd(22), c.line);
}
await browser.close();
