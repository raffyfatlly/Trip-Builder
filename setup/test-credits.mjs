// Does the ledger charge the right amount, and does the gate stop the right
// things?
//
// The numbers below are the measured ones from real beta sessions, not
// examples. If the pricing changes, this is where it should fail first.
//
//   node setup/test-credits.mjs

import assert from 'assert';
import crypto from 'crypto';

// Firestore has to look configured before anything imports it, and the ledger
// is then served by the stub below rather than the network.
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'p', client_email: 'a@b.c', private_key: privateKey,
});
process.env.JOURNAL_LOCAL = '1';

const DOCS = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('oauth2.googleapis.com')) {
    return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
  }
  if (u.includes('firestore.googleapis.com')) {
    const path = u.split('/documents')[0 + 1].split('?')[0];
    if ((opts.method || 'GET') === 'GET') {
      const doc = DOCS.get(path);
      return new Response(doc ? JSON.stringify(doc) : '{}', { status: doc ? 200 : 404 });
    }
    const body = JSON.parse(opts.body || '{}');
    const prev = DOCS.get(path) || { fields: {} };
    DOCS.set(path, { name: 'projects/p/databases/(default)/documents' + path, fields: { ...prev.fields, ...body.fields } });
    return new Response(JSON.stringify(DOCS.get(path)), { status: 200 });
  }
  return realFetch(url, opts);
};

const C = await import('../lib/credits.js');
const J = await import('../lib/journal.js');

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

console.log('\nthe rate card');

const cfg = C.explain();
ok('markup is inside the 3-5x he asked for', cfg.markup >= 3 && cfg.markup <= 5, cfg.markup + 'x');
// raffy, 2026-09-05: "reflect the credit to be alligned with the one we use in
// landing page. maybe thousands seems to much." public/welcome/index.html says
// "Planning a whole trip — 50". Everything here is that number's consequence.
ok('a whole trip is about 50 credits, as the landing page says',
   Math.abs(C.creditsFor(3.55) - 50) <= 3, C.creditsFor(3.55) + ' for the median trip');
ok('a free grant is one trip and a bit', cfg.grant === 70);
ok('and it can cost him about RM22', Math.abs(cfg.grantCostsMyr - 21.7) < 0.01, 'RM' + cfg.grantCostsMyr);
ok('a credit costs RM0.31 to serve and should sell for RM1.55',
   cfg.myrPerCredit === 0.31 && cfg.creditSellsFor === 1.55);
ok('nothing is in the thousands any more', cfg.grant < 1000 && C.creditsFor(9.30) < 1000);

console.log('\nwhat the measured trips would charge');

// Real totals, from the sessions themselves.
const TRIPS = [
  ['Chiang Mai (4 nights, one base)', 4.08],
  ['Hanoi + Ninh Binh (7 days, two cities)', 2.95],
  ['cheapest beta session', 1.8437],
  ['median beta session', 3.55],
  ['p90 beta session', 9.30],
];
for (const [name, usd] of TRIPS) {
  const c = C.creditsFor(usd);
  console.log('   ' + name.padEnd(38) + String(c).padStart(4) + ' credits   RM'
    + C.costMyr(c).toFixed(2).padStart(6) + ' to serve   RM'
    + C.retailMyr(c).toFixed(2).padStart(7) + ' at ' + cfg.markup + 'x   '
    + (c <= cfg.grant ? 'inside the free grant' : 'RUNS OUT'));
}

ok('the median trip fits inside the free grant', C.creditsFor(3.55) < cfg.grant);
ok('with something left over — "a bit more"', cfg.grant - C.creditsFor(3.55) >= 15,
   (cfg.grant - C.creditsFor(3.55)) + ' spare');
ok('a p90 research marathon does NOT fit, so it is capped', C.creditsFor(9.30) > cfg.grant);

console.log('\nrounding never goes his way by accident');
ok('a fraction of a credit rounds up', C.creditsFor(0.0001) === 1);
ok('zero is zero', C.creditsFor(0) === 0);
ok('and so is nonsense', C.creditsFor(null) === 0 && C.creditsFor(-5) === 0);

console.log('\nbilling a session');

const S = 'sesn_' + 'x'.repeat(20);
J.spendTotal(S, 'chat', 'claude-sonnet-5', { in: 1, out: 1, calls: 1 }, 1.90);
await new Promise((r) => setTimeout(r, 30));
J.note(S, 'who', {});
await J.addMetered(S, { 'places.search': { calls: 10, usd: 0.32 } }, 'someone@example.com');

const first = await C.settle(S);
ok('a session is charged what it actually spent', first && first.credits === C.creditsFor(2.22),
   first ? first.credits + ' credits for $' + first.usd.toFixed(2) : 'nothing');

const again = await C.settle(S);
ok('and charging twice takes nothing the second time', again === null);

J.spendAdd(S, 'builder', 'deepseek/deepseek-chat-v3-0324', { in: 1, out: 1, usd: 0.30 });
await new Promise((r) => setTimeout(r, 30));
const third = await C.settle(S);
ok('a later cost is charged as a difference, not a total',
   third && third.credits === C.creditsFor(0.30),
   third ? third.credits + ' credits' : 'nothing');

console.log('\nthe gate');

const purse = await C.allowed('someone@example.com', S);
ok('a signed-in person has a balance', purse.granted === C.explain().grant);
ok('and has been charged for the session', purse.used > 0, purse.used + ' used');
ok('and can still send', purse.ok);

// Spend the rest.
const { readLedger, writeLedger } = await import('../lib/firestore.js');
const l = await readLedger('u:someone@example.com');
await writeLedger({ ...l, used: l.granted });

const broke = await C.allowed('someone@example.com', S);
ok('spent out, the gate closes', !broke.ok && broke.left === 0);

const anon = await C.allowed('', 'sesn_' + 'y'.repeat(20));
ok('anonymous gets its own, smaller allowance', anon.ok && anon.granted === C.explain().anonGrant);
ok('which stops short of a whole trip', anon.granted < C.creditsFor(2.95));


console.log('\nthe ring: two arcs that add up');

{
  const S2 = 'sesn_' + 'r'.repeat(20);
  // A trip shaped like the real ones: the conversation costs more than the
  // build, and the Places lookups sit between them.
  J.spendTotal(S2, 'chat', 'claude-sonnet-5', { in: 1, out: 1, calls: 1 }, 1.90);
  J.spendAdd(S2, 'builder', 'deepseek/deepseek-chat-v3-0324', { in: 1, out: 1, usd: 0.30 });
  await new Promise((r) => setTimeout(r, 40));
  await J.addMetered(S2, { 'places.search': { calls: 42, usd: 1.34 } }, 'ringer@example.com');

  const d = await C.settle(S2);
  ok('the split adds back to the total charged', d && d.plan + d.build === d.credits,
     d ? d.plan + ' + ' + d.build + ' = ' + d.credits : 'nothing');
  ok('planning is the bigger half, as measured', d && d.plan > d.build,
     d ? Math.round(100 * d.plan / d.credits) + '% planning' : '');
  ok('and building is not zero', d && d.build > 0);

  const p2 = await C.allowed('ringer@example.com', S2);
  ok('the ledger keeps both halves', p2.plan > 0 && p2.build > 0,
     p2.plan + ' planning, ' + p2.build + ' building');
  ok('and they still add up on the ledger', p2.plan + p2.build === p2.used);
}

{
  // A session that never built anything. The ring must not draw an orange arc
  // for work that did not happen.
  const S3 = 'sesn_' + 'q'.repeat(20);
  J.spendTotal(S3, 'chat', 'claude-sonnet-5', { in: 1, out: 1, calls: 1 }, 0.80);
  await new Promise((r) => setTimeout(r, 40));
  await J.addMetered(S3, { 'places.search': { calls: 5, usd: 0.16 } }, 'talker@example.com');
  const d = await C.settle(S3);
  ok('an abandoned session is all planning', d && d.build === 0 && d.plan === d.credits,
     d ? d.plan + ' planning, ' + d.build + ' building' : 'nothing');
}

console.log(fail ? '\n' + fail + ' FAILED\n' : '\nall passed\n');
process.exit(fail ? 1 : 0);
