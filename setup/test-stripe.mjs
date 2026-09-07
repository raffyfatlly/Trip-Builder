// The two ways a payment integration loses money, and the guards against them.
//
// raffy, 2026-09-07: "im targeting about RM 28 for first payment ... make sure
// for every rm 28 they spend. i will not incur more than RM 10 cost."
//
//   node setup/test-stripe.mjs
import assert from 'node:assert';
import crypto from 'crypto';

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_for_this_file_only';
const S = await import('../lib/stripe.js');

let n = 0;
const t = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };

const sign = (body, secret, at = Math.floor(Date.now() / 1000)) => {
  const v1 = crypto.createHmac('sha256', secret).update(at + '.' + body).digest('hex');
  return 't=' + at + ',v1=' + v1;
};
const SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const BODY = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });

console.log('\nthe webhook is not a free credit dispenser');

t('a properly signed event verifies', () => {
  assert.equal(S.verify(BODY, sign(BODY, SECRET)).id, 'evt_1');
});

t('a forged signature is refused', () => {
  assert.throws(() => S.verify(BODY, sign(BODY, 'whsec_the_wrong_secret')), /does not match/);
});

t('a body changed after signing is refused', () => {
  const sig = sign(BODY, SECRET);
  const tampered = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', extra: 1 });
  assert.throws(() => S.verify(tampered, sig), /does not match/);
});

t('an old signature cannot be replayed', () => {
  const old = Math.floor(Date.now() / 1000) - 3600;
  assert.throws(() => S.verify(BODY, sign(BODY, SECRET, old)), /too old/);
});

t('a missing or malformed header is refused', () => {
  assert.throws(() => S.verify(BODY, ''), /malformed/);
  assert.throws(() => S.verify(BODY, 'garbage'), /malformed/);
});

t('a signature of the wrong length cannot be timing-attacked', () => {
  assert.throws(() => S.verify(BODY, 't=' + Math.floor(Date.now() / 1000) + ',v1=ab'), /does not match/);
});

console.log('\nthe packs cannot break the ceiling');

// A credit is ten sen of cost; a pack must sell for at least 2.8x what its
// credits can consume. This is the rule as an assertion, so a hand-edited
// config that breaks it is refused at checkout rather than found in a bill.
const COST = 0.10, FLOOR = 2.8;
for (const p of S.packs()) {
  t('"' + p.name + '" RM' + p.myr + ' / ' + p.credits + ' credits holds the ceiling', () => {
    assert.ok(S.packSafe(p, COST, FLOOR),
      'RM' + p.myr + ' buys ' + (p.credits * COST).toFixed(2) + ' of cost');
  });
}

t('RM28 buys exactly 100 credits — RM10 of cost', () => {
  const starter = S.packById('starter');
  assert.equal(starter.myr, 28);
  assert.equal(starter.credits, 100);
  assert.equal(+(starter.credits * COST).toFixed(2), 10);
});

t('a pack that gives too much is caught', () => {
  assert.ok(!S.packSafe({ myr: 28, credits: 1000 }, COST, FLOOR), 'RM100 of cost for RM28 passed');
});

t('every pack holds the same multiple — no bulk discount eating the margin', () => {
  const rates = S.packs().map((p) => p.myr / (p.credits * COST));
  assert.ok(Math.max(...rates) - Math.min(...rates) < 0.2, JSON.stringify(rates));
});

console.log('\nwhat a build actually costs, against what a pack buys');
{
  const C = await import('../lib/credits.js');
  const trip = C.creditsFor(1.00);           // a typical trip, measured
  t('a RM28 pack covers a typical trip twice over', () => assert.ok(trip * 2 <= 100, trip + ' each'));
  t('and the free grant covers none of it', () => assert.ok(C.explain().grant < trip));
}

console.log('\nwhich events grant credits');

// The webhook's own list, asserted here so a future edit that drops the async
// event is caught. FPX (Malaysian online banking) completes UNPAID and confirms
// minutes later; listening only for checkout.session.completed would take the
// money and never grant the credits.
{
  const src = await import('node:fs').then((fs) => fs.readFileSync('pages/api/stripe-webhook.js', 'utf8'));
  t('a completed checkout grants', () => assert.ok(src.includes("'checkout.session.completed'")));
  t('and so does a confirmed async payment — FPX pays this way', () =>
    assert.ok(src.includes("'checkout.session.async_payment_succeeded'")));
  t('but only when payment_status is actually paid', () =>
    assert.ok(/payment_status !== 'paid'/.test(src)));
  t('a failed async payment is logged, not silently dropped', () =>
    assert.ok(src.includes('async_payment_failed')));
  t('everything else is acknowledged and ignored', () => assert.ok(/ignored: event\.type/.test(src)));
}

console.log('\n' + n + ' passed');
