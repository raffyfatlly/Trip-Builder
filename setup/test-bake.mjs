// A saved trip keeps its photographs.
//
// raffy, 2026-09-03: "make sure the photos stay in app too."
//
// The file used to keep them as URLs. /api/photo is a relative path, so opened
// from disk it resolves to file:///api/photo and every Google Places photo is a
// broken image; anything on another host is one outage from the same. So the
// download fetches them server-side and folds them in as data URIs.
//
//   BASE=http://localhost:3400 node setup/test-bake.mjs

const B = process.env.BASE || 'http://localhost:3400';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const post = (body) => fetch(B + '/api/bake', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

console.log('');

// A real image this repo already serves, reached by relative path — the exact
// shape /api/photo has, and the one that broke.
const rel = await post({ urls: { hero: '/welcome/img/halong.jpg' } });
ok('a relative photo comes back as bytes', /^data:image\//.test(rel.photos.hero || ''), (rel.photos.hero || 'missing').slice(0, 30));
ok('and it is the whole picture, not a stub', (rel.photos.hero || '').length > 20000, (rel.photos.hero || '').length + ' chars');

// Not an image, and a host that does not exist. Both must be skipped, not fatal.
const bad = await post({ urls: {
  page: '/welcome/index.html',
  gone: 'https://nothing.invalid/x.jpg',
  good: '/welcome/img/bali.jpg',
} });
ok('an HTML page is not baked in as a photo', !bad.photos.page);
ok('a host that does not answer is skipped', !bad.photos.gone);
ok('and the good one still comes back', /^data:image\//.test(bad.photos.good || ''));

ok('nothing to bake is not an error', Object.keys((await post({ urls: {} })).photos || {}).length === 0);

const notAllowed = await fetch(B + '/api/bake').then((r) => r.status);
ok('GET is refused', notAllowed === 405, String(notAllowed));

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
