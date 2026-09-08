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


// TOP UP IS AN AMOUNT, NOT A PACK. raffy, 2026-09-08: "the topup function is rm
// 10 minimum. then user can put any amount after that."
//
// The money side of a free-text field is where a pricing bug becomes a refund,
// so the rules are asserted rather than trusted: a floor, a cap, the same rate
// as the named packs, and rounding that never goes the customer's way by
// accident.
console.log('\na custom top-up');
{
  const { topupFor, TOPUP_MIN, TOPUP_MAX } = await import('../lib/stripe.js');
  const rate = 0.10 * 2.8;               // RM0.28 a credit, the pack rate

  t('the minimum is RM10 and it is inclusive', () => {
    assert.equal(topupFor(TOPUP_MIN, rate).myr, 10);
    assert.equal(topupFor(9.99, rate), null);
    assert.equal(topupFor(0, rate), null);
    assert.equal(topupFor(-50, rate), null);
  });
  t('anything above it is allowed, to a sane cap', () => {
    assert.equal(topupFor(12, rate).credits, 42);
    assert.equal(topupFor(50, rate).credits, 178);
    assert.ok(topupFor(TOPUP_MAX, rate));
    assert.equal(topupFor(TOPUP_MAX + 1, rate), null);
  });
  t('it buys at exactly the pack rate — no bulk discount', () => {
    // RM28 buys 100 credits as a named pack. Typed as a top-up it must buy the
    // same 100, or the two prices on one screen disagree with each other.
    assert.equal(topupFor(28, rate).credits, 100);
    assert.equal(topupFor(68, rate).credits, 242);
  });
  t('and rounds DOWN, always', () => {
    // RM10 is 35.7 credits. A credit given away is a credit served at a loss.
    assert.equal(topupFor(10, rate).credits, 35);
    assert.equal(topupFor(10.27, rate).credits, 36);
  });
  t('nonsense is refused rather than priced', () => {
    assert.equal(topupFor('abc', rate), null);
    assert.equal(topupFor(null, rate), null);
    assert.equal(topupFor(50, 0), null);
  });
  t('a custom amount still respects the ceiling', async () => {
    const { packSafe } = await import('../lib/stripe.js');
    for (const myr of [10, 12, 37.5, 500]) {
      assert.ok(packSafe(topupFor(myr, rate), 0.10, 2.8), 'RM' + myr);
    }
  });
}


// FPX: OFFERED, BUT NEVER AT THE COST OF TAKING NO MONEY AT ALL.
//
// raffy, 2026-09-08: "also i want to enable fpx." Online banking is how a great
// many Malaysians pay, so leaving it to Stripe's automatic selection — which
// depends on a Dashboard setting nobody can see from the code — is not good
// enough. It is named explicitly.
//
// The risk that creates: naming a method the account has not been approved for
// makes Stripe reject the WHOLE request, so a checkout that could have taken a
// card would take nothing while FPX activation is pending. These cover the
// fallback that stops that.
console.log('\nFPX at checkout');
{
  // A key shaped like a test key, so stripeReady() is true. Nothing here ever
  // reaches Stripe — every request is answered by the stub below.
  process.env.STRIPE_SECRET = 'sk_test_notarealkey';
  const S = await import('../lib/stripe.js');
  const calls = [];
  const realFetch = globalThis.fetch;

  const run = async (fail) => {
    calls.length = 0;
    globalThis.fetch = async (url, opts = {}) => {
      const body = String(opts.body || '');
      calls.push(body);
      const wantsFpx = /payment_method_types(%5B|\[)\d+(%5D|\])=fpx/.test(body)
        || body.includes('=fpx');
      if (fail && wantsFpx) {
        return new Response(JSON.stringify({ error: {
          message: 'The payment method type provided: fpx is invalid. '
            + 'You must activate it in your dashboard.',
          type: 'invalid_request_error',
        } }), { status: 400 });
      }
      return new Response(JSON.stringify({
        id: 'cs_test_1', url: 'https://checkout.stripe.com/x',
        payment_method_types: wantsFpx ? ['card', 'fpx'] : ['card'],
      }), { status: 200 });
    };
    const out = await S.checkout({
      pack: 'topup', who: 'a@b.com', origin: 'https://x.y',
      amount: { id: 'topup', name: 'Top up', myr: 10, credits: 35 },
    });
    globalThis.fetch = realFetch;
    return out;
  };

  const good = await run(false);
  t('the payment screen is asked for card AND fpx', () => {
    assert.ok(calls[0].includes('fpx'), calls[0].slice(0, 200));
    assert.ok(calls[0].includes('card'), calls[0].slice(0, 200));
  });
  t('and one request is all it takes when the account allows it', () => {
    assert.equal(calls.length, 1);
    assert.deepEqual(good.payment_method_types, ['card', 'fpx']);
  });

  const fell = await run(true);
  t('an account without FPX approved still takes cards', () => {
    // The whole point. Stripe rejects the method, not the sale — so the sale
    // must survive it. Two requests: the hopeful one, then card alone.
    assert.equal(calls.length, 2);
    assert.ok(!calls[1].includes('fpx'), calls[1].slice(0, 200));
    assert.deepEqual(fell.payment_method_types, ['card']);
  });
  t('and the customer never sees the difference', () => {
    assert.ok(fell.url, 'a checkout url came back either way');
  });
}

console.log('\n' + n + ' passed');
