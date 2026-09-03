// Browser-side rendering of the itinerary preview.
//
// The renderer is the same module the CLI uses. The only difference here is
// that a manifest and a touch icon are meaningless inside an iframe, and the
// service worker is same-origin only, so those references are dropped.

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

// This function used to delete both @font-face rules and swap in Google Fonts,
// because at the time the template pointed at fonts/*.woff2 and those files do
// not exist here. Then the faces were baked into the template as data URIs
// (see setup/test-fontbaked.mjs) and nobody came back to this file — so the
// download had the right typefaces and the preview, which is the thing he
// actually looks at, quietly rendered in Google's Outfit and Plus Jakarta
// Sans instead. That is the whole of "it doesn't use the font that i want in
// that app", said more times than it should have needed.
//
// Nothing to swap now. The fonts are in the string already; leave them there.
function forWeb(html) {
  return html
    .replace(/<link rel="preload" as="font"[^>]*>/g, '')
    .replace(/<link rel="manifest"[^>]*>/g, '')
    .replace(/<link rel="(apple-touch-)?icon"[^>]*>/g, '')
    // The service worker is same-origin only and would 404 inside a srcdoc frame.
    .replace(/<script[^>]*>[^<]*serviceWorker[\s\S]*?<\/script>/g, '');
}

export async function renderPreview(itinerary) {
  const { html } = render(itinerary, await template());
  return forWeb(html);
}

export function downloadName(itinerary) {
  const t = (itinerary && itinerary.trip && itinerary.trip.title) || 'itinerary';
  return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.html';
}
