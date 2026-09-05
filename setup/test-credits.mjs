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
ok('a free grant is one median trip and a bit', cfg.grant === 10000);
ok('and it can cost him at most RM20', cfg.grantCostsMyr === 20, 'RM' + cfg.grantCostsMyr);
ok('worth RM100 of retail', cfg.grantWorthMyr === 100);

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
  const covered = c <= cfg.grant;
  console.log('   ' + name.padEnd(38) + String(c).padStart(6) + ' credits   RM'
    + C.retailMyr(c).toFixed(2).padStart(7) + ' retail   RM' + C.costMyr(c).toFixed(2).padStart(6)
    + ' cost   ' + (covered ? 'inside the free grant' : 'RUNS OUT'));
}

ok('the median trip fits inside the free grant', C.creditsFor(3.55) < cfg.grant);
ok('with something left over — "a bit more"', cfg.grant - C.creditsFor(3.55) > 1500,
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
ok('which stops short of a build', anon.granted < C.creditsFor(2.95));

console.log(fail ? '\n' + fail + ' FAILED\n' : '\nall passed\n');
process.exit(fail ? 1 : 0);
