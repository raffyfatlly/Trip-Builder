// The landing page is a single self-contained file in public/, which Next
// serves at its real path and nowhere else: there is no directory index for
// static files, so /welcome on its own would 404 and /welcome/ would 308.
//
// A rewrite gives it the address it should have had. The redirect retires the
// file path, so the ugly one stops appearing in shared links and search
// results. Rewrites do not re-run redirects, so the pair does not loop.
const nextConfig = {
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
