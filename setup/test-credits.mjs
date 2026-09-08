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
    // Firestore's atomic add, which is how credits are charged now — the
    // read-modify-write it replaced lost charges whenever two requests settled
    // at once. Modelled here rather than mocked away, because "does a second
    // writer still count?" is the whole question.
    if (path === ':commit') {
      for (const w of (JSON.parse(opts.body || '{}').writes || [])) {
        const name = w.update.name;
        const at = name.split('/documents')[1];
        const fields = { ...((DOCS.get(at) || {}).fields || {}), ...(w.update.fields || {}) };
        for (const t of w.updateTransforms || []) {
          const was = Number((fields[t.fieldPath] || {}).integerValue || 0);
          fields[t.fieldPath] = { integerValue: String(was + Number(t.increment.integerValue || 0)) };
        }
        DOCS.set(at, { name, fields });
      }
      return new Response('{}', { status: 200 });
    }
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
// THE RULE THIS WHOLE FILE NOW ENCODES. raffy, 2026-09-07:
//
//   "im targeting about RM 28 for first payment ... just that make sure for
//    every rm 28 they spend. i will not incur more than RM 10 cost."
//
// A ceiling, not a margin — a margin can be broken by one expensive turn and a
// ceiling cannot. It replaces the 3-5x these tests used to assert, and the free
// grant that used to cover a whole trip.
ok('a credit is ten sen of real cost', cfg.myrPerCredit === 0.10, 'RM' + cfg.myrPerCredit);
ok('and sells for 28 sen — RM28 buys 100', cfg.creditSellsFor === 0.28
   && Math.abs(100 * cfg.creditSellsFor - 28) < 0.01, 'RM' + cfg.creditSellsFor);
ok('so RM28 can never cost him more than RM10', Math.abs(100 * cfg.myrPerCredit - 10) < 0.01,
   'RM' + (100 * cfg.myrPerCredit).toFixed(2));
ok('the ceiling holds at 2.8x, his floor', cfg.markup >= 2.8, cfg.markup + 'x');

// Measured 2026-09-07 from Anthropic's own session records: a light trip (KL,
// the only one built on the current stack) is $0.62 all in, a heavy one $1.10.
ok('a trip is 27-49 credits, a number you can hold in your head',
   C.creditsFor(0.62) >= 25 && C.creditsFor(1.10) <= 50,
   C.creditsFor(0.62) + ' light, ' + C.creditsFor(1.10) + ' heavy');
ok('so RM28 is one big trip with room, usually two',
   Math.floor(100 / C.creditsFor(1.00)) >= 2, Math.floor(100 / C.creditsFor(1.00)) + ' typical trips');

// THE FREE TIER, and what it is allowed to cost.
//
// It was "about seven turns" at a measured 0.44 credits a turn, which made it 4.
// That measurement predates research, photo cards and live price checks: a real
// free session on 2026-09-08 ran 3.5 credits a TURN, so 4 credits was one turn
// and a bit. raffy, seeing it: "4 credits is too little doesn't demonstrate a
// good part of the app. add it to 10."
//
// Ten is three or four turns — enough to see the thing work — and the range
// below is what stops it drifting back to useless or up into free-trip
// territory. The RM ceiling is the number he actually cares about: it is what
// one signup can cost him if they spend every credit.
ok('the free grant is enough to see the app work', cfg.grant >= 8 && cfg.grant <= 14,
   cfg.grant + ' credits');
ok('and costs him at most RM1 a signup', cfg.grantCostsMyr <= 1, 'RM' + cfg.grantCostsMyr);
// THE INVARIANT THE BUILD GATE NOW RESTS ON.
//
// The gate was two conditions — "never paid" and "cannot afford it" — and the
// first one misfired on raffy, who had bought credits before that flag existed
// and was told to buy what he already had. So the gate is the balance alone,
// and this is what keeps the free tier out: the grant MUST stay below the cost
// of a build. Change either number without the other and the paywall opens.
ok('a free account CANNOT afford a build — the whole paywall rests on this',
   cfg.grant < C.rebuildCredits(),
   cfg.grant + ' free credits vs a build at ' + C.rebuildCredits());
ok('and a bought pack comfortably can', 100 >= C.rebuildCredits(),
   '100 credits vs ' + C.rebuildCredits());
ok('nothing is in the thousands', cfg.grant < 1000 && C.creditsFor(9.30) < 1000);

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

// The free grant deliberately does NOT cover a trip any more. It used to, and
// that was the old deal; the new one is a few real turns and a paywall at the
// build.
ok('a trip does NOT fit inside the free grant', C.creditsFor(0.62) > cfg.grant,
   C.creditsFor(0.62) + ' credits vs a grant of ' + cfg.grant);
ok('but a RM28 pack covers even the heaviest trip', C.creditsFor(1.10) <= 100,
   C.creditsFor(1.10) + ' of 100');
ok('and two typical trips still fit', 2 * C.creditsFor(1.00) <= 100, 2 * C.creditsFor(1.00) + ' of 100');

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
// The difference is taken on the ROUNDED RUNNING TOTAL, not by rounding the
// increment. That distinction is the whole of the overcharge fix (raffy's wife
// was billed 58 credits for a 41-credit session), and this assertion still
// encoded the old behaviour: creditsFor(0.30) rounds the increment up on its
// own, which is exactly the per-request rounding that was removed.
//
//   creditsFor(2.22) = 32, creditsFor(2.52) = 36  ->  4 owed
//   creditsFor(0.30) = 5                          <- the old, inflated answer
ok('a later cost is charged as a difference, not a total',
   third && third.credits === C.creditsFor(2.52) - C.creditsFor(2.22),
   third ? third.credits + ' credits' : 'nothing');
ok('and that is less than rounding the increment on its own would have taken',
   third && third.credits < C.creditsFor(0.30),
   third ? third.credits + ' vs ' + C.creditsFor(0.30) : 'nothing');

console.log('\nthe gate');

const purse = await C.allowed('someone@example.com', S);
ok('a signed-in person has a balance', purse.granted === C.explain().grant);
ok('and has been charged for the session', purse.used > 0, purse.used + ' used');
// This session spent $2.52 — 111 credits, well past a free grant of 4. Under
// the old economics (grant 70, RM0.31 a credit) it fitted; under the new deal a
// free account cannot run a trip, which is the paywall doing its job rather
// than a fault. So the realistic case is a customer who has PAID.
ok('a free account is stopped by it', !purse.ok, purse.used + ' used of ' + purse.granted);
{
  const { readLedger: rl, writeLedger: wl } = await import('../lib/firestore.js');
  const id = 'u:someone@example.com';
  const l = await rl(id);
  // ONE PACK IS NOT ENOUGH HERE, and that is the ceiling working rather than
  // failing. This fixture spent $2.52 = RM11.10 of real cost, which is MORE than
  // the RM10 a single RM28 pack is allowed to buy. A session that expensive is
  // supposed to run out and ask for another pack — that is precisely the
  // promise "for every rm 28 they spend, i will not incur more than RM 10 cost".
  await wl({ ...l, granted: (l.granted || 0) + 100 });   // one RM28 pack
  const one = await C.allowed('someone@example.com', S);
  ok('one pack does NOT cover an RM11 session — the ceiling holds', !one.ok,
     one.used + ' used of ' + one.granted);
  await wl({ ...(await rl(id)), granted: (await rl(id)).granted + 100 });   // a second
  const paid = await C.allowed('someone@example.com', S);
  ok('a second pack lets them carry on', paid.ok, paid.used + ' used of ' + paid.granted);
}

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

// THE CHARGE THAT WENT MISSING.
//
// raffy, 2026-09-08: "after so many turns, there are no credit charge except
// the first 4 credit upon onboarding." His journal said 13 credits charged
// against a ledger that said 4.
//
// A chat turn has several metered requests in flight at once — an /api/advance
// that runs for a minute, an /api/state poll every two seconds — and every one
// of them settles. settle() read the ledger, added its charge and wrote the
// whole document back, so two landing together meant the second wrote a stale
// total over the first. The journal marks the money settled either way, so a
// lost charge is lost for good.
console.log('\nconcurrent charges');
{
  const S4 = 'sesn_' + 'r'.repeat(20);
  const who = 'racer@example.com';
  await J.addMetered(S4, { 'places.search': { calls: 1, usd: 0.02 } }, who);
  await C.settle(S4, who);
  const one = (await C.allowed(who, S4)).used;
  ok('one charge lands', one > 0, one + ' used');

  // Four requests that each metered something, settling at the same moment.
  const S5 = 'sesn_' + 's'.repeat(20);
  const her = 'racer2@example.com';
  let want = 0;
  for (const usd of [0.05, 0.05, 0.05, 0.05]) {
    await J.addMetered(S5, { 'places.search': { calls: 1, usd } }, her);
    want += 1;
  }
  // Settle them together, as the app does.
  await Promise.all([C.settle(S5, her), C.settle(S5, her), C.settle(S5, her), C.settle(S5, her)]);
  const p = await C.allowed(her, S5);
  const owed = C.creditsFor(0.20);
  ok('and four landing together all count', p.used === owed,
     p.used + ' charged of ' + owed + ' owed');
  ok('the ledger never goes backwards', p.used >= one);
}

console.log(fail ? '\n' + fail + ' FAILED\n' : '\nall passed\n');
process.exit(fail ? 1 : 0);
