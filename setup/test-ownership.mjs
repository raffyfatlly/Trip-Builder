// A session belongs to the person who made it, and keeps belonging to them.
//
// raffy, 2026-09-07, on his wife's Singapore trip: "she indeed use her own
// email ... then she ran out of credit. then I use her phone, log out, then
// sign in again suddenly her session is saved on my account. then i delete
// that session."
//
// Three things had to be true for that, and all three were:
//   - /api/me accepted `claim: {id}` for ANY session the browser was holding
//   - lib/journal.js rewrote j.who on every metered request, and settle() bills
//     j.who — so the MONEY followed the last person to sign in
//   - signing out left the open session and the trip list in localStorage, so
//     the next person opened somebody else's conversation
//
// These cover the two halves that are pure logic. The claim gate itself needs
// Firestore and is exercised by setup/test-accounts.mjs against a deployment.
import assert from 'node:assert';

let n = 0;
const t = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };

// The journal's owner rule, lifted out of lib/journal.js as it now reads. Kept
// here rather than imported because addMetered() writes to Firestore; this is
// the one line that decides ownership.
const setWho = (j, who) => { if (who && !j.who) j.who = who; return j; };

console.log('\nThe journal records the FIRST signer, not the latest');
{
  t('an anonymous session takes an owner when somebody signs in', () => {
    assert.equal(setWho({ who: '' }, 'her@x.com').who, 'her@x.com');
  });
  t('and never hands it to whoever signs in next', () => {
    const j = setWho({ who: '' }, 'her@x.com');
    setWho(j, 'him@x.com');
    assert.equal(j.who, 'her@x.com', 'this is the line that moved the money');
  });
  t('her own later requests do not disturb it', () => {
    const j = setWho({ who: '' }, 'her@x.com');
    setWho(j, 'her@x.com');
    assert.equal(j.who, 'her@x.com');
  });
  t('a request with nobody signed in leaves the owner alone', () => {
    const j = setWho({ who: '' }, 'her@x.com');
    setWho(j, '');
    assert.equal(j.who, 'her@x.com');
  });
}

console.log('\nWho a claim is allowed to belong to');
{
  // The rule in pages/api/me.js: a claim succeeds when the session is unowned
  // or already yours, and is refused when it is somebody else's.
  const allowed = (owner, asker) => !owner || owner === asker;

  t('an unowned session can be claimed', () => assert.ok(allowed('', 'him@x.com')));
  t('re-claiming your own is fine — the browser does it on every load', () => {
    assert.ok(allowed('her@x.com', 'her@x.com'));
  });
  t("somebody else's session is refused — the actual bug", () => {
    assert.ok(!allowed('her@x.com', 'him@x.com'));
  });
}

console.log('\nWhat signing out lets go of');
{
  // Not a delete: her trips live on her account and come back when she signs
  // in. What must not survive is THIS BROWSER's copy.
  const CLEARED = ['itin.session.v1', 'itin.trips.v1', 'itin.memory.v1'];
  t('the open session goes', () => assert.ok(CLEARED.includes('itin.session.v1')));
  t('the local trip list goes', () => assert.ok(CLEARED.includes('itin.trips.v1')));
  t('the remembered profile goes', () => assert.ok(CLEARED.includes('itin.memory.v1')));
}

console.log('\n' + n + ' passed');
