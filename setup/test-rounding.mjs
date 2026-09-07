// Nobody pays 41% more than their trip cost.
//
// raffy, 2026-09-07, on his wife's Singapore trip: it cost $2.838 — 41 credits
// — and she was charged 58 against a grant of 70. She ran out, and not because
// the trip was expensive.
//
// creditsFor() rounds UP on purpose: a fractional credit rounded down is an
// error in our favour on every request, and there are a lot of requests. That
// reasoning is right; the implementation inverted it. settle() runs after every
// metered request, so the round-up applied to each increment SEPARATELY —
// about twenty times in her session, each adding up to a whole credit nobody
// spent.
//
// This is a simulation rather than a call into journal.js, because the real
// path needs Firestore. It reproduces the arithmetic exactly: many small
// deltas, charged one at a time.
import assert from 'node:assert';

let n = 0;
const t = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };

// creditsFor(), as it is: USD -> MYR -> credits, rounded up.
const USD_MYR = 4.4;
const MYR_PER_CREDIT = 0.31;
const creditsFor = (usd) => Math.ceil(Math.max(0, usd) * USD_MYR / MYR_PER_CREDIT);

// The old way: round up each increment as it arrives.
const perIncrement = (deltas) => deltas.reduce((a, d) => a + creditsFor(d), 0);

// The new way: round up the running total, subtract what is already charged.
const onTotal = (deltas) => {
  let charged = 0;
  let total = 0;
  for (const d of deltas) {
    total += d;
    const owed = creditsFor(total) - charged;
    if (owed > 0) charged += owed;
  }
  return charged;
};

// Her session: $2.838, arriving as many small charges rather than one.
//
// The exact split is not recoverable — the journal keeps totals, not a list of
// increments — so this does NOT try to reproduce her 58 to the credit. Twenty
// even parts gives 60, which is the same bug at the same scale and is all the
// test needs to prove. Asserting 58 here would be inventing a precision the
// data does not have.
const HERS = Array.from({ length: 20 }, () => 2.838 / 20);

console.log('\nHer Singapore trip');
{
  t('really cost 41 credits', () => assert.equal(creditsFor(2.838), 41));
  t('the old way overcharges badly (she was billed 58)', () => {
    const old = perIncrement(HERS);
    assert.ok(old >= 55 && old <= 62, 'got ' + old);
    assert.ok(old > 41 * 1.3, 'the overcharge should be ~40%, got ' + old);
  });
  t('is charged exactly what it cost now', () => assert.equal(onTotal(HERS), 41));
}

console.log('\nThe intent is kept: never charge less than it cost');
{
  const cost = (usd) => usd * USD_MYR / MYR_PER_CREDIT;
  for (const usd of [0.001, 0.01, 0.1, 0.5, 1, 2.838, 9.3]) {
    t('$' + usd + ' is never undercharged', () => {
      const deltas = Array.from({ length: 15 }, () => usd / 15);
      assert.ok(onTotal(deltas) >= cost(usd) - 1e-9,
        onTotal(deltas) + ' < ' + cost(usd));
    });
  }
  t('and is over by at most one credit for a whole session', () => {
    for (const usd of [0.05, 0.3, 1.7, 2.838, 5, 9.3]) {
      const deltas = Array.from({ length: 30 }, () => usd / 30);
      assert.ok(onTotal(deltas) - cost(usd) < 1, usd + ' -> ' + (onTotal(deltas) - cost(usd)));
    }
  });
}

console.log('\nThe overcharge scaled with how CHATTY somebody was');
{
  // The worst part: two people spending the same money were charged
  // differently depending on how many requests it took. That is why it went
  // unnoticed — no single charge was wrong.
  t('the old way punished more requests for the same spend', () => {
    const few = perIncrement(Array.from({ length: 5 }, () => 2.838 / 5));
    const many = perIncrement(Array.from({ length: 40 }, () => 2.838 / 40));
    assert.ok(many > few, few + ' vs ' + many);
  });
  t('the new way does not care how it was split', () => {
    for (const parts of [1, 5, 20, 40, 100]) {
      assert.equal(onTotal(Array.from({ length: parts }, () => 2.838 / parts)), 41,
        'split into ' + parts);
    }
  });
}

console.log('\nSpend too small to cross a credit is kept, not lost');
{
  t('a run of tiny charges eventually bills', () => {
    // Each of these is worth a fraction of a credit. If sub-credit spend were
    // dropped rather than carried, a busy session would be free.
    const tiny = Array.from({ length: 100 }, () => 0.0005);
    assert.equal(onTotal(tiny), creditsFor(0.05));
    assert.ok(onTotal(tiny) > 0);
  });
}

console.log('\n' + n + ' passed');
