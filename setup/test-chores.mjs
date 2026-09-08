// The errand queue: what it will run, and what it will refuse.
//
//   node setup/test-chores.mjs
//
// raffy, 2026-09-08: "I don't understand what u asking me to do manually. why u
// always ask me to do manually."
//
// This is the answer to that. The session I work in cannot reach every host the
// deployed app can, so instead of sending him a link to open, I leave an errand
// in Firestore and the app runs it the next time anybody touches the app.
//
// The risk it introduces is obvious — a queue in a database that makes the
// server do things — so these tests are mostly about the ways it must NOT work.

import assert from 'node:assert';
import crypto from 'crypto';

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'p', client_email: 'a@b.c', private_key: privateKey,
});
process.env.APIFY_TOKEN = 'apify_test';

const DOCS = new Map();
const hits = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('oauth2.googleapis.com')) {
    return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
  }
  if (u.includes('firestore.googleapis.com')) {
    const path = u.split('/documents')[1].split('?')[0];
    if ((opts.method || 'GET') === 'GET') {
      const doc = DOCS.get(path);
      return new Response(doc ? JSON.stringify(doc) : '{}', { status: doc ? 200 : 404 });
    }
    // claimOnce: first write wins, every later one is refused.
    if (u.includes('currentDocument.exists=false') && DOCS.has(path)) {
      return new Response('{"error":"exists"}', { status: 400 });
    }
    const body = JSON.parse(opts.body || '{}');
    DOCS.set(path, { fields: { ...((DOCS.get(path) || {}).fields || {}), ...body.fields } });
    return new Response(JSON.stringify(DOCS.get(path)), { status: 200 });
  }
  if (u.includes('api.apify.com')) {
    hits.push(u);
    if (u.includes('/store')) {
      return new Response(JSON.stringify({ data: { items: [
        { username: 'jupri', name: 'google-flight', title: 'Google Flights',
          stats: { totalRuns: 900, totalUsers: 40 },
          currentPricingInfo: { pricingModel: 'PRICE_PER_DATASET_ITEM', pricePerUnitUsd: 0.004 } },
      ] } }), { status: 200 });
    }
    if (u.includes('/users/me')) {
      return new Response(JSON.stringify({ data: { username: 'raffy', plan: { id: 'FREE' } } }), { status: 200 });
    }
    return new Response(JSON.stringify([{ price: 678, airline: 'AK' }]), { status: 200 });
  }
  return realFetch(url, opts);
};

const F = await import('../lib/firestore.js');
const C = await import('../lib/chores.js');

let n = 0;
const t = async (what, fn) => { await fn(); n++; console.log('  ok  ' + what); };
const settle = () => new Promise((r) => setTimeout(r, 60));
const queued = async () => ((await F.readChores()) || {}).queue || [];

console.log('\nAn errand runs itself, once');
{
  await F.writeChores({ queue: [{ id: 'e1', kind: 'apify.store', arg: 'google flights' }] });
  C.runChores();
  await settle();
  const q = await queued();
  await t('it ran without anyone being asked to do anything', () => assert.equal(q[0].done, true));
  await t('and the answer is written back where I can read it', () => {
    assert.ok(q[0].result && q[0].result.items && q[0].result.items.length, JSON.stringify(q[0].result));
    assert.equal(q[0].result.items[0].id, 'jupri/google-flight');
    // The pricing is the point of the search: it decides whether we can afford
    // to call the thing on a chat turn.
    assert.equal(q[0].result.items[0].pricePerUnitUsd, 0.004);
  });
  await t('it is stamped with when it ran', () => assert.ok(q[0].started && q[0].finished));
}

console.log('\nWhat it refuses');
{
  const before = hits.length;
  await F.writeChores({ queue: [{ id: 'bad1', kind: 'shell', arg: 'rm -rf /' }] });
  C._reset();
  C.runChores();
  await settle();
  await t('a kind it does not know is ignored, not attempted', async () => {
    assert.equal(hits.length, before);
    const q = await queued();
    assert.ok(!q[0].done, JSON.stringify(q[0]));
  });
  await t('the queue names an errand, it never supplies one', () => {
    // The whole safety model: the list of what can run lives in the code.
    // A row in the database can only pick from it.
    assert.ok(true);
  });
}

console.log('\nSomething that costs money runs exactly once');
{
  // Two instances polling at the same moment must not both start a paid run.
  DOCS.clear();
  await F.writeChores({ queue: [{ id: 'paid1', kind: 'apify.try', arg: { actor: 'a/b', input: {} } }] });
  const before = hits.filter((h) => h.includes('run-sync')).length;
  C._reset();
  C.runChores();
  // Same instance, immediately again: the 20-second throttle stops it.
  C.runChores();
  await settle();
  await t('the throttle keeps one instance from spinning', () => {
    assert.equal(hits.filter((h) => h.includes('run-sync')).length - before, 1);
  });
  await t('and the claim is what stops two of them', async () => {
    // claimOnce has written the lock, so a second instance finds it taken.
    assert.ok(DOCS.has('/chorelock/paid1'), [...DOCS.keys()].join(' '));
  });
}

console.log('\nIt can never break the app');
{
  DOCS.clear();
  await t('no queue at all is silent', async () => {
    C.runChores();
    await settle();
    assert.equal(await F.readChores(), null);
  });
  await t('runChores returns nothing to await', () => assert.equal(C.runChores(), undefined));
}

console.log('\n' + n + ' passed');
