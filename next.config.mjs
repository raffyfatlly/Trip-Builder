// The landing page is a single self-contained file in public/, which Next
// serves at its real path and nowhere else: there is no directory index for
// static files, so /welcome on its own would 404 and /welcome/ would 308.
//
// A rewrite gives it the address it should have had. The redirect retires the
// file path, so the ugly one stops appearing in shared links and search
// results. Rewrites do not re-run redirects, so the pair does not loop.
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

// The preview asks /api/template for the app shell and the answer is cached
// hard, because the template only changes on deploy. That was true and still
// wrong: the URL never changed, so a browser holding a year-long copy of
// yesterday's template ran today's renderer against it, every splice missed,
// render() threw, and the preview pane sat on "Your itinerary will appear
// here" forever — through reloads, through rebuilds, with nothing on screen
// to say anything had failed.
//
// Hashing the template into the URL is what makes "immutable" honest: change
// the file and the address changes with it, so no cache anywhere can serve
// the stale one.
const templateHash = createHash('sha256')
  .update(readFileSync('./public/app-template.html.gz'))
  .digest('hex')
  .slice(0, 12);

const nextConfig = {
  env: { NEXT_PUBLIC_TEMPLATE_V: templateHash },
  // public/ is served by the CDN, NOT bundled into the lambda.
  //
  // /t/[s] renders the built trip on the server, so it needs the template as a
  // FILE — and got "ENOENT /var/task/public/app-template.html.gz" in production
  // while working perfectly in `next start`, because locally the whole repo is
  // on disk. raffy hit it the moment he tapped Install as an app: a bare 500.
  //
  // Next only ships files it can see being used, and a path built with
  // path.join at run time is invisible to that. This says so explicitly. The
  // page also falls back to fetching /api/template over HTTP if the read still
  // fails, because a feature that works on one deploy target and not another is
  // not finished.
  experimental: {
    outputFileTracingIncludes: {
      '/t/[s]': ['./public/app-template.html.gz'],
    },
  },
  // lib/net.js is the single chokepoint every outbound request goes through,
  // and lib/meter.js hangs off it to count what each one costs. The meter needs
  // AsyncLocalStorage, which is node-only — and net.js is also reachable from
  // the browser bundle, through renderer/render.js, which runs client-side to
  // draw the preview.
  //
  // Rather than give up the single chokepoint (the whole reason the meter
  // catches services nobody remembered to instrument), the browser build gets
  // an empty module here and lib/meter.js degrades to a no-op when
  // AsyncLocalStorage is not a function. Nothing in the browser is billed to us.
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { ...(config.resolve.fallback || {}), async_hooks: false };
    }
    return config;
  },
  async rewrites() {
    return [{ source: '/welcome', destination: '/welcome/index.html' }];
  },
  async redirects() {
    return [
      { source: '/welcome/index.html', destination: '/welcome', permanent: true },
      { source: '/welcome/', destination: '/welcome', permanent: true },
    ];
  },
};

export default nextConfig;
