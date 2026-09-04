// The meter counts every service, and tags them to the right session.
//
// This is the test that matters for the pricing numbers: if the price book or
// the chokepoint quietly stops matching reality, the report keeps printing
// confident figures that are wrong — which is worse than printing nothing.
//
//   node setup/test-meter.mjs

import assert from 'assert';
import { withSession, currentSession, count, drain, drainHouse } from '../lib/meter.js';
import { photoProxy } from '../lib/photos.js';

const S = 'sesn_0123456789abcdefgh';

// Outside a session nothing lands on whoever happened to be last — it goes to
// the house instead, which is checked further down.
count('https://places.googleapis.com/v1/places:searchText', true);
assert.equal(drain(), null, 'counted outside a session');
assert.equal(currentSession(), '');
drainHouse(true);

await withSession(S, async () => {
  assert.equal(currentSession(), S);

  count('https://places.googleapis.com/v1/places:searchText', true);
  count('https://places.googleapis.com/v1/places/x/photos/y/media?maxWidthPx=1200', true);
  count('https://places.googleapis.com/v1/places/x/photos/y/media?maxWidthPx=1200', false);
  count('https://routes.googleapis.com/directions/v2:computeRoutes', true);
  count('https://api.open-meteo.com/v1/forecast', true);
  count('https://some-new-thing.example.com/v1/go', true);

  // Nothing on this machine is billed to us, and the test suite calls both of
  // these deliberately. They must not turn up as services.
  count('http://127.0.0.1:3400/api/state', true);
  count('http://localhost:3400/api/state', true);
  count('https://nothing.invalid/', false);

  // The two that report their own cost are skipped here so they are not
  // counted twice — once as a guess, once for real. Their money is written by
  // spendTotal and spendAdd instead.
  count('https://api.anthropic.com/v1/messages', true);
  count('https://openrouter.ai/api/v1/chat/completions', true);

  const t = drain();

  assert.equal(t['places.search'].calls, 1);
  assert.equal(+t['places.search'].usd.toFixed(4), 0.032);

  // The photo endpoint is a different SKU from search, and both failed and
  // successful media requests are billed by Google.
  assert.equal(t['places.photo'].calls, 2);
  assert.equal(t['places.photo'].failed, 1);
  assert.equal(+t['places.photo'].usd.toFixed(4), 0.014);

  assert.equal(t.routes.calls, 1);
  assert.equal(t.weather.usd, 0, 'free is still free');
  assert.equal(t.weather.calls, 1, 'free is still counted');

  // A host nobody priced shows up under its own name, flagged, at zero. This
  // is how the next unbilled service gets noticed instead of vanishing.
  assert.ok(t['other:some-new-thing.example.com'], 'unknown host was dropped');
  assert.equal(t['other:some-new-thing.example.com'].unknown, true);
  assert.ok(!t['other:127.0.0.1'] && !t['other:localhost'] && !t['other:nothing.invalid'],
    'a local address was counted as a service');

  assert.ok(!t.chat, 'anthropic double-counted');
  assert.ok(!t.builder, 'openrouter double-counted');

  assert.equal(drain(), null, 'drain did not clear');
});

// Photo URLs must NOT carry the session, inside one or not. Place lookups are
// cached and itineraries are shared, so a tagged URL bills whoever happened to
// mint it first — for as long as the trip is looked at. Tried on 2026-09-04,
// caught by this same smoke test, reverted.
const clean = '/api/photo?ref=places%2Fa%2Fphotos%2Fb';
assert.equal(photoProxy('places/a/photos/b'), clean);
await withSession(S, async () => {
  assert.equal(photoProxy('places/a/photos/b'), clean, 'photo URL leaked a session');
  drain();
});

// Spend with no session goes to the house rather than nowhere, and is batched
// so that serving an image is not a database write.
assert.equal(drainHouse(), null, 'house flushed with nothing in it');
for (let i = 0; i < 24; i++) count('https://places.googleapis.com/v1/places/x/photos/y/media', true);
assert.equal(drainHouse(), null, 'house flushed before it was worth a write');
count('https://places.googleapis.com/v1/places/x/photos/y/media', true);
const h = drainHouse();
assert.equal(h['places.photo'].calls, 25);
assert.equal(+h['places.photo'].usd.toFixed(4), 0.175);
assert.equal(drainHouse(true), null, 'house did not clear');

// And a session in flight never picks up house spend, or vice versa.
count('https://routes.googleapis.com/x', true);
await withSession(S, async () => {
  count('https://maps.googleapis.com/x', true);
  const t = drain();
  assert.ok(!t.routes, 'session picked up house spend');
  assert.equal(t.maps.calls, 1);
});
const h2 = drainHouse(true);
assert.equal(h2.routes.calls, 1);
assert.ok(!h2.maps, 'house picked up session spend');

// Two sessions in flight at once must not bleed into each other. This is the
// whole reason for AsyncLocalStorage rather than a module-level variable.
const A = 'sesn_aaaaaaaaaaaaaaaaaa', B = 'sesn_bbbbbbbbbbbbbbbbbb';
const [ra, rb] = await Promise.all([
  withSession(A, async () => {
    count('https://routes.googleapis.com/x', true);
    await new Promise((r) => setTimeout(r, 20));
    count('https://routes.googleapis.com/x', true);
    return drain();
  }),
  withSession(B, async () => {
    await new Promise((r) => setTimeout(r, 10));
    count('https://maps.googleapis.com/x', true);
    return drain();
  }),
]);
assert.equal(ra.routes.calls, 2);
assert.ok(!ra.maps, 'session A picked up session B');
assert.equal(rb.maps.calls, 1);
assert.ok(!rb.routes, 'session B picked up session A');

console.log('meter ok');
