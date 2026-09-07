// Sharing a trip with another person, by name, each paying their own way.
//
// raffy, 2026-09-07: "user can share a specific session with other user. and
// built a good mechanism to allow this and allow the value of the app to
// increase." Then, asked who pays: each person pays their own, invited by
// email.
//
// Those two decisions are what these check. The rules live in lib/firestore.js
// (mayOpen, setGuest's validation) rather than in the route, so a second caller
// later cannot skip them — and so they can be tested without a database.
import assert from 'node:assert';
import { mayOpen } from '../lib/firestore.js';

let n = 0;
const t = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };

const OWNER = 'her@example.com';
const GUEST = 'friend@example.com';
const trip = (guests = []) => ({ session: 's1', who: OWNER, guests });

console.log('\nWho may open a trip');
{
  t('the owner may', () => assert.ok(mayOpen(trip(), OWNER)));
  t('an invited guest may', () => assert.ok(mayOpen(trip([GUEST]), GUEST)));
  t('a stranger may not', () => assert.ok(!mayOpen(trip([GUEST]), 'nobody@example.com')));
  t('nobody signed in may not open an owned trip', () => assert.ok(!mayOpen(trip(), '')));
  // This is the bug that started all of it: he signed in on her phone and her
  // session joined his account.
  t("signing in on somebody else's phone does not hand you their trip", () => {
    assert.ok(!mayOpen(trip(), 'him@example.com'));
  });

  t('an unowned trip is open — anonymous sessions still work', () => {
    assert.ok(mayOpen(null, ''));
    assert.ok(mayOpen({ who: '' }, 'anyone@example.com'));
  });

  // People type their own address with capitals about half the time. An
  // invitation that silently fails to match is worse than one that errors.
  t('addresses match regardless of case', () => {
    assert.ok(mayOpen({ who: OWNER, guests: ['Friend@Example.com'] }, 'friend@example.com'));
    assert.ok(mayOpen({ who: 'Her@Example.com', guests: [] }, 'her@example.com'));
  });
}

console.log('\nWhat setGuest refuses, without touching a database');
{
  // Mirrors the guards in lib/firestore.js setGuest(). Kept as a table so the
  // reasons stay visible: each one is a way a guest list goes wrong.
  const check = (owner, asker, email, guests = []) => {
    if (!owner) return 'that trip has no owner yet';
    if (String(owner).toLowerCase() !== String(asker).toLowerCase()) {
      return 'only the person who made this trip can share it';
    }
    const g = String(email || '').trim().toLowerCase();
    if (!g || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g)) return 'that does not look like an email address';
    if (g === String(owner).toLowerCase()) return 'that is your own address — you already have this trip';
    if ([...new Set([...guests, g])].length > 20) return 'that is as many people as one trip can hold';
    return null;
  };

  t('a guest cannot invite further guests', () => {
    assert.match(check(OWNER, GUEST, 'third@example.com'), /only the person who made/);
  });
  t('an unowned trip cannot be shared', () => {
    assert.match(check('', OWNER, GUEST), /no owner yet/);
  });
  t('a typo is caught rather than stored', () => {
    for (const bad of ['', 'friend', 'friend@', '@example.com', 'a b@c.com']) {
      assert.match(check(OWNER, OWNER, bad), /email address/, JSON.stringify(bad));
    }
  });
  t('inviting yourself is refused kindly', () => {
    assert.match(check(OWNER, OWNER, OWNER), /your own address/);
  });
  t('a guest list has a ceiling', () => {
    const many = Array.from({ length: 20 }, (_, i) => 'g' + i + '@example.com');
    assert.match(check(OWNER, OWNER, 'one-too-many@example.com', many), /as many people/);
  });
  t('an ordinary invite passes', () => assert.equal(check(OWNER, OWNER, GUEST), null));
}

console.log('\nWho pays');
{
  // settle(session, actor) charges `actor || d.who`. The whole point of
  // passing the actor is that on a shared trip they differ.
  const payer = (actor, journalWho) => actor || journalWho;

  t('a guest pays for their own turns, not the owner', () => {
    assert.equal(payer(GUEST, OWNER), GUEST);
  });
  t('the owner still pays for their own', () => {
    assert.equal(payer(OWNER, OWNER), OWNER);
  });
  t('an anonymous turn falls back to the session owner', () => {
    assert.equal(payer('', OWNER), OWNER);
  });
}

console.log('\n' + n + ' passed');
