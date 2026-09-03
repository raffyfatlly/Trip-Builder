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
