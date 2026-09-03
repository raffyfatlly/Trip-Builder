// Browser-side rendering of the itinerary preview.
//
// The renderer is the same module the CLI uses. The only difference here is
// that a deployed preview has no local font or icon files, so those references
// are swapped for Google Fonts and the icon links are dropped.

import { render } from '../renderer/render.js';

let templatePromise = null;
function template() {
  if (!templatePromise) {
    // The version is the template's own hash, baked in at build time (see
    // next.config.mjs). It is what lets the response be cached forever
    // without a deploy's new template being hidden behind an old one.
    const v = process.env.NEXT_PUBLIC_TEMPLATE_V || 'dev';
    templatePromise = fetch('/api/template?v=' + v).then((r) => {
      if (!r.ok) throw new Error('template ' + r.status);
      return r.text();
    });
  }
  return templatePromise;
}

const GOOGLE_FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?' +
  'family=Outfit:wght@400;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap">';

function forWeb(html) {
  return html
    // The two @font-face rules point at fonts/*.woff2, which do not exist here.
    .replace(/@font-face\{font-family:'Outfit'[^}]*\}/g, "")
    .replace(/@font-face\{font-family:'Jakarta'[^}]*\}/g, "")
    .replace(/font-family:'Jakarta'/g, "font-family:'Plus Jakarta Sans'")
    .replace(/<link rel="preload" as="font"[^>]*>/g, '')
    .replace(/<link rel="manifest"[^>]*>/g, '')
    .replace(/<link rel="(apple-touch-)?icon"[^>]*>/g, '')
    // The service worker is same-origin only and would 404 inside a srcdoc frame.
    .replace(/<script[^>]*>[^<]*serviceWorker[\s\S]*?<\/script>/g, '')
    .replace('</head>', GOOGLE_FONTS + '</head>');
}

export async function renderPreview(itinerary) {
  const { html } = render(itinerary, await template());
  return forWeb(html);
}

export function downloadName(itinerary) {
  const t = (itinerary && itinerary.trip && itinerary.trip.title) || 'itinerary';
  return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.html';
}
