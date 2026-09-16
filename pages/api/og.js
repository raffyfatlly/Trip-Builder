// The picture a shared trip shows in WhatsApp, iMessage and everywhere else.
//
// raffy, 2026-09-16: "every trip someone shares silently advertises the app
// before anyone clicks... something that intrigues people to open the link."
//
// So this is not a logo on a coloured square. What makes somebody tap a link
// their sister sent is the trip itself: the place, photographed; how long they
// are going for; and three things that are actually in the plan, with a count
// of what is not shown. The count is the whole trick — "+21 more" is a question
// only the link can answer. The brand signs the bottom corner and says nothing
// else, which is what "silently" has to mean.
//
// Everything is drawn from query parameters that pages/t/[s].js already has in
// hand when it renders the trip. Nothing is looked up here, and that is
// deliberate: a link pasted into a group chat is fetched by every crawler that
// sees it, and a card that read the session would bill an Anthropic call and
// two Firestore reads per preview, for a picture.

import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { OUTFIT_400, OUTFIT_800 } from '../../lib/ogfonts.js';
import { signed } from '../../lib/ogsign.js';

// NOT the edge runtime, on purpose — this ran there first and WhatsApp would
// not show it.
//
// raffy, 2026-09-16: "yep fix it. its not showing." The card was correctly in
// the page's HTML and the image rendered fine in a browser; the difference
// was invisible until the raw response headers were read. Vercel's edge
// runtime always answers with `Transfer-Encoding: chunked` and no
// `Content-Length` — a stream whose size is not known up front, which is
// exactly what an edge function is built to serve and exactly what a browser
// does not care about. WhatsApp's link-preview fetcher does: an og:image
// with no declared length is one it silently drops, which from the outside
// looks identical to the crawler never trying at all.
//
// The Node.js serverless runtime doesn't have that problem — a Buffer handed
// to `res.end()` gets a real Content-Length because Node knows its size
// before it sends the first byte. Slower per request than the edge, and it
// does not matter: a link preview is fetched once per share and cached by
// the client afterwards, so correctness here is worth far more than the
// difference in cold-start time.

const W = 1200;
const H = 630;

// The app's own palette, from the template's :root. A share that does not look
// like the thing it opens is an advert for somebody else.
const DEEP = '#10362A';
const DEEP_2 = '#0A2A20';
const ON_DEEP = '#C9DCD0';
const CORAL = '#EE7B45';

const b64 = (s) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

// Decoded once per warm instance rather than per request: 75kB of TTF through
// atob on every WhatsApp preview is free to avoid.
let FONTS = null;
const fonts = () => (FONTS || (FONTS = [
  { name: 'Outfit', data: b64(OUTFIT_400), weight: 400, style: 'normal' },
  { name: 'Outfit', data: b64(OUTFIT_800), weight: 800, style: 'normal' },
]));

// WHAT THIS ROUTE IS ALLOWED TO FETCH.
//
// Two doors, and nothing else gets in. A Google Places reference is proved by
// its own shape and resolved through our /api/photo, exactly as every other
// photo in the app is. Any other URL has to carry a signature this deployment
// minted — see lib/ogsign.js for why that is a signature rather than a list of
// allowed hosts: the best photograph of a hotel lives on the hotel's website,
// so the set of legitimate hosts is every host there is.
//
// A photo that fails either door is not an error. It falls through to the
// typographic card, which is built to be worth looking at on its own.
const PLACES_REF = /^places\/[A-Za-z0-9_-]{4,128}\/photos\/[A-Za-z0-9_-]{4,512}$/;

const MAX_PHOTO = 6_000_000;

async function cover(p, tag, origin) {
  if (!p) return '';
  let url = '';
  if (PLACES_REF.test(p)) {
    url = origin + '/api/photo?w=1200&ref=' + encodeURIComponent(p);
  } else if (p.startsWith('https://') && await signed(p, tag)) {
    url = p;
  }
  if (!url) return '';

  // A photo that is slow is worse than no photo: a crawler that times out
  // shows no card at all, and the card without the picture is still good.
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 3500);
  try {
    const r = await fetch(url, { signal: stop.signal });
    if (!r.ok) return '';
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (!/^image\/(jpeg|png|webp)$/i.test(type)) return '';
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_PHOTO) return '';
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    }
    return 'data:' + type + ';base64,' + btoa(bin);
  } catch (err) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

// Parameters are text somebody else wrote. Length is the only real defence a
// picture needs — there is no markup to escape — and a card that has run out
// of room is a worse advert than one that says less.
const text = (v, max) => String(v || '')
  .replace(/[\x00-\x1f\x7f]/g, ' ')
  .trim()
  .slice(0, max);

const clip = (s, max) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);

// The destination is the loudest thing on the card, so it sets its own size:
// "Bali" at the size that suits "Frankfurt & Hesse" is timid, and the reverse
// wraps to three lines and pushes the facts off the bottom.
const titleSize = (t) => {
  if (t.length <= 9) return 112;
  if (t.length <= 14) return 96;
  if (t.length <= 20) return 80;
  if (t.length <= 28) return 66;
  return 56;
};

export default async function handler(req, res) {
  const q = (k) => (Array.isArray(req.query[k]) ? req.query[k][0] : req.query[k]) || '';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const proto = /^localhost|^127\./.test(host) ? 'http' : 'https';
  const origin = proto + '://' + host;

  const title = clip(text(q('t'), 60), 34) || 'A trip in the making';
  const facts = clip(text(q('f'), 90), 64);
  const hint = clip(text(q('h'), 140), 76);
  const planning = q('s') === 'planning';
  const photo = await cover(text(q('p'), 700), text(q('k'), 40), origin);

  const img = new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: 'flex',
          position: 'relative',
          overflow: 'hidden',
          backgroundColor: DEEP,
          backgroundImage: `linear-gradient(145deg, ${DEEP} 0%, ${DEEP_2} 100%)`,
          fontFamily: 'Outfit',
        }}
      >
        {photo ? (
          <img
            src={photo}
            width={W}
            height={H}
            style={{ position: 'absolute', top: 0, left: 0, width: W, height: H, objectFit: 'cover' }}
          />
        ) : (
          <>
            {/* Depth, so the card with no photograph is not a flat rectangle
                of green. Three soft lights rather than a pattern or a
                letterform: the destination's own initial was tried first and
                is a bare rectangle whenever the place begins with an I or an
                L, which is not texture, it is a smudge. Light cannot fail on
                any input. */}
            <div
              style={{
                position: 'absolute', top: -340, left: 470, width: 1040, height: 1040,
                display: 'flex', borderRadius: 1040,
                backgroundImage: 'radial-gradient(circle, rgba(226,235,222,.17) 0%, rgba(226,235,222,0) 68%)',
              }}
            />
            <div
              style={{
                position: 'absolute', top: 200, left: 690, width: 840, height: 840,
                display: 'flex', borderRadius: 840,
                backgroundImage: 'radial-gradient(circle, rgba(238,123,69,.15) 0%, rgba(238,123,69,0) 66%)',
              }}
            />
            <div
              style={{
                position: 'absolute', top: -200, left: -250, width: 780, height: 780,
                display: 'flex', borderRadius: 780,
                backgroundImage: 'radial-gradient(circle, rgba(201,220,208,.1) 0%, rgba(201,220,208,0) 70%)',
              }}
            />
          </>
        )}

        {/* Scrims only over a photograph — on the plain card they would just
            mute a gradient that was chosen. Two of them, because one is a
            gamble on what the picture happens to be: the vertical carries the
            text block, and the horizontal keeps a bright sky on the right from
            washing out the left column. The short top one is for the mark. */}
        {photo && (
          <>
            <div
              style={{
                position: 'absolute', top: 0, left: 0, width: W, height: H, display: 'flex',
                backgroundImage:
                  'linear-gradient(to bottom, rgba(10,42,32,.34) 0%, rgba(10,42,32,0) 24%,'
                  + ' rgba(10,42,32,0) 38%, rgba(10,42,32,.5) 62%,'
                  + ' rgba(10,42,32,.86) 84%, rgba(10,42,32,.94) 100%)',
              }}
            />
            <div
              style={{
                position: 'absolute', top: 0, left: 0, width: W, height: H, display: 'flex',
                backgroundImage: 'linear-gradient(to right, rgba(10,42,32,.44) 0%, rgba(10,42,32,0) 56%)',
              }}
            />
          </>
        )}

        {/* The mark sits top left, where a reader starts, and stays out of the
            way of everything that is actually about the trip. */}
        <div style={{ position: 'absolute', left: 64, top: 52, display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: 12, height: 12, borderRadius: 12, backgroundColor: CORAL,
              display: 'flex', marginRight: 12,
            }}
          />
          <div
            style={{
              display: 'flex', color: 'rgba(255,255,255,.82)',
              fontSize: 22, fontWeight: 800, letterSpacing: 2.6,
            }}
          >
            TRIP BUILDER
          </div>
        </div>

        <div
          style={{
            position: 'absolute', left: 64, bottom: 54, width: W - 128,
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
          }}
        >
          {planning && (
            <div
              style={{
                display: 'flex', alignItems: 'center', marginBottom: 20,
                backgroundColor: CORAL, color: '#20150F',
                borderRadius: 999, padding: '9px 20px 11px',
                fontSize: 21, fontWeight: 800, letterSpacing: 1.6,
              }}
            >
              BEING PLANNED
            </div>
          )}

          <div
            style={{
              display: 'flex', color: '#FFFFFF', fontWeight: 800,
              fontSize: titleSize(title), letterSpacing: -2.2, lineHeight: 1.02,
            }}
          >
            {title}
          </div>

          {facts && (
            <div
              style={{
                display: 'flex', marginTop: 20, color: ON_DEEP,
                fontSize: 30, fontWeight: 400, letterSpacing: 0.1,
              }}
            >
              {facts}
            </div>
          )}

          {hint && (
            <div
              style={{
                display: 'flex', marginTop: 15, color: 'rgba(255,255,255,.58)',
                fontSize: 25, fontWeight: 400, maxWidth: 1000,
              }}
            >
              {hint}
            </div>
          )}
        </div>
      </div>
    ),
    { width: W, height: H, fonts: fonts() },
  );

  // A real Buffer, not a stream — see the note at the top of this file for why.
  const png = Buffer.from(await img.arrayBuffer());

  // raffy, 2026-09-16, still after the Content-Length fix: "still nothing.
  // just link. not even an image." The Sorrento card — the same one photo
  // cards always are, a photograph filling 1200×630 — came back as a 1.4MB
  // PNG. PNG is lossless, so a photograph costs what a photograph actually
  // weighs uncompressed; the plain typographic card, which is mostly one
  // flat colour, was 140kB from the same route and worked. WhatsApp caps how
  // large an og:image it will fetch well under a megabyte, so every card
  // with a photo — which is the good case, the one this whole feature is
  // for — was silently unviewable no matter how correct the headers were.
  //
  // Re-encoded as JPEG, which is what photographs are for: the same picture
  // at quality 82 lands around a tenth of the PNG's size. mozjpeg rather
  // than libjpeg (sharp's default) because it is meaningfully smaller at the
  // same visual quality for exactly this kind of photo-plus-flat-text image.
  const jpeg = await sharp(png).jpeg({ quality: 82, mozjpeg: true }).toBuffer();

  res.setHeader('content-type', 'image/jpeg');
  res.setHeader('content-length', String(jpeg.length));
  // Crawlers refetch on every share. A trip does change — an edit, a new
  // photograph — so this is cached in front rather than for ever.
  res.setHeader('cache-control', 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).end(jpeg);
}
