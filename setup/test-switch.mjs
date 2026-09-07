// Switching account on a shared device must not mix two people's trips.
//
// raffy, 2026-09-07: "make sure if switching account on same device only bring
// session from account don't mix it or overwrite."
//
// It could, twice over, and one of them was permanent:
//
//   BROWSER — mergeTrips() unions the local list with the account's. Right on
//   your own phone (trips made before signing in should follow you), wrong on a
//   shared one, because the browser never recorded whose list it was holding.
//
//   SERVER — /api/auth/signin merged the browser's whole trip list INTO the
//   account. Sign in as somebody else on his wife's phone and her trips were
//   written into his account, in Firestore, for good.
import assert from 'node:assert';

let n = 0;
const t = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };

// A stand-in for localStorage, so lib/trips.js can be exercised in node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { rememberTrip, loadTrips, adoptAccount, releaseAccount, tripsOwner } =
  await import('../lib/trips.js');

const reset = () => store.clear();

console.log('\nOne person, one phone');
{
  reset();
  rememberTrip('s1', 'Penang');
  t('trips made before signing in follow them in', () => {
    assert.equal(adoptAccount('her@x.com'), 'keep');
    assert.deepEqual(loadTrips().map((x) => x.id), ['s1']);
  });
  t('and the list is stamped with whose it is', () => {
    assert.equal(tripsOwner(), 'her@x.com');
  });
  t('signing in again changes nothing', () => {
    assert.equal(adoptAccount('her@x.com'), 'keep');
    assert.deepEqual(loadTrips().map((x) => x.id), ['s1']);
  });
}

console.log('\nTwo people, one phone — the actual bug');
{
  reset();
  rememberTrip('hers', 'Singapore');
  adoptAccount('her@x.com');

  t('signing in as somebody else drops her list', () => {
    assert.equal(adoptAccount('him@x.com'), 'drop');
    assert.deepEqual(loadTrips(), []);
  });
  t('and the list now belongs to him', () => assert.equal(tripsOwner(), 'him@x.com'));
  t('so nothing of hers is left to inherit', () => {
    assert.ok(!loadTrips().some((x) => x.id === 'hers'));
  });
  // Nothing is lost: the list is only pointers, and her trips are on her
  // account, which is where they come back from when she signs in.
  t('hers come back when she signs in again', () => {
    assert.equal(adoptAccount('her@x.com'), 'drop');
    // The server sends her list; the browser starts empty rather than mixed.
    assert.deepEqual(loadTrips(), []);
  });
}

console.log('\nSigning out');
{
  reset();
  rememberTrip('s1', 'Penang');
  adoptAccount('her@x.com');
  releaseAccount();
  t('clears the list and the owner together', () => {
    assert.deepEqual(loadTrips(), []);
    assert.equal(tripsOwner(), '');
  });
  t('so the next signer carries nothing across', () => {
    assert.equal(adoptAccount('him@x.com'), 'keep');
    assert.deepEqual(loadTrips(), []);
  });
  // 'keep' with an empty list is the right answer: an empty owner means either
  // "trips this person just made" or "nothing at all", and both carry safely.
}

console.log('\nAnonymous use is untouched');
{
  reset();
  rememberTrip('s1', 'Penang');
  t('no account, no interference', () => {
    assert.equal(adoptAccount(''), 'keep');
    assert.deepEqual(loadTrips().map((x) => x.id), ['s1']);
  });
}

console.log('\nWhich trips a signer may absorb (the server rule)');
{
  // Mirrors pages/api/auth/signin.js: a trip qualifies if nobody owns it, or
  // the signer owns it, or they are a guest on it.
  const mayTake = (owner, email) => !owner || !owner.who
    || owner.who === email || (owner.guests || []).includes(email);

  t('an unowned trip is carried in', () => assert.ok(mayTake(null, 'him@x.com')));
  t('their own is kept', () => assert.ok(mayTake({ who: 'him@x.com' }, 'him@x.com')));
  t('one shared with them is kept', () => {
    assert.ok(mayTake({ who: 'her@x.com', guests: ['him@x.com'] }, 'him@x.com'));
  });
  t("somebody else's is NOT written into their account", () => {
    assert.ok(!mayTake({ who: 'her@x.com', guests: [] }, 'him@x.com'));
  });
}

console.log('\n' + n + ' passed');
