// One trip, served on its own URL, so it can be installed like an app.
//
// raffy, 2026-09-06: "Download as PWS app (like my phu quoc I can download as
// app.)"
//
// His Phu Quoc app was installable because it was SERVED — a manifest and a
// service worker next to it at real URLs. A downloaded HTML file can never be:
// file:// cannot register a worker and a manifest has nothing to point at. So
// the install lives here. Add to Home Screen on this page gives a standalone
// app with the destination's name and its own icon, and the worker keeps it
// opening with no signal, which is the entire reason to have it on a phone
// abroad.
//
// Rendered on the server so the first paint is the trip rather than a spinner,
// and so the page is a real document for a crawler, a share sheet and print.

import Head from 'next/head';
import { getState } from '../../lib/managedAgents.js';
import { render } from '../../renderer/render.js';
import { groundQuery, mapPoints, BAKE_W } from '../../lib/mapfit.js';
import { fetchWith } from '../../lib/net.js';

export default function Trip({ html, title, session, missing }) {
  if (missing) {
    return (
      <>
        <Head><title>Trip not found</title></Head>
        <main style={{
          minHeight: '100dvh', display: 'grid', placeItems: 'center', margin: 0,
          background: '#EDF2EA', color: '#0C241B', textAlign: 'center', padding: 24,
          fontFamily: 'system-ui, sans-serif',
        }}>
          <div>
            <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>No trip here yet</h1>
            <p style={{ fontSize: 14, color: '#4C6157', margin: 0, lineHeight: 1.5 }}>
              This link is for a trip that has been built. Open the chat and build it first.
            </p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{title}</title>
        <link rel="manifest" href={'/api/manifest?s=' + encodeURIComponent(session)} />
        <meta name="theme-color" content="#10362A" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content={title} />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      {/* The built app is a whole document. It is injected rather than
          reconstructed as React, because it IS the deliverable — the same bytes
          that get downloaded — and rebuilding it here would mean two renderers
          to keep in step. */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <script
        dangerouslySetInnerHTML={{
          __html: "if('serviceWorker' in navigator){window.addEventListener('load',function(){"
            + "navigator.serviceWorker.register('/sw.js',{scope:'/t/'}).catch(function(){});});}",
        }}
      />
    </>
  );
}

// Everything the trip needs to work with no network: the map as bytes.
// The photographs already come baked into the itinerary's `photos` map when the
// traveller has downloaded it; here they are still URLs and that is fine,
// because this page HAS a network the first time it is opened and the worker
// caches what it fetched.
async function bakeGround(it, host, proto) {
  const pts = mapPoints(it);
  if (!pts.length || !host) return it;
  const q = groundQuery(pts, BAKE_W);
  try {
    const r = await fetchWith(
      proto + '://' + host + '/api/map?c=' + encodeURIComponent(q.c) + '&z=' + q.z + '&w=' + q.w,
      12000,
    );
    if (!r.ok) return it;
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (!/^image\//i.test(type)) return it;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 4_000_000) return it;
    return {
      ...it,
      ground: {
        url: 'data:' + type + ';base64,' + buf.toString('base64'),
        cLat: q.cLat, cLon: q.cLon, z: q.z, w: q.w,
      },
    };
  } catch (err) {
    // A trip without its ground still works; it just draws on plain sage.
    return it;
  }
}

export async function getServerSideProps(ctx) {
  const session = String(ctx.params.s || '');
  const host = ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host || '';
  const proto = /^localhost|^127\./.test(host) ? 'http' : 'https';

  let it = null;
  try {
    const state = await getState(session);
    it = state && state.itinerary;
  } catch (err) {
    it = null;
  }
  if (!it || !(it.days || []).length) {
    return { props: { missing: true, html: '', title: 'Trip', session } };
  }

  it = await bakeGround(it, host, proto);

  const zlib = await import('zlib');
  const fs = await import('fs');
  const path = await import('path');
  const tpl = zlib.gunzipSync(
    fs.readFileSync(path.join(process.cwd(), 'public', 'app-template.html.gz')),
  ).toString();

  const { html } = render(it, tpl);
  // The document's own head and shell are Next's here, so only the body of the
  // built app is injected. Its own <script> tags come with it.
  const body = html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
  const styles = (html.match(/<style[\s\S]*?<\/style>/gi) || []).join('\n');

  return {
    props: {
      missing: false,
      session,
      title: (it.trip && it.trip.title) || 'Trip',
      html: styles + body,
    },
  };
}
