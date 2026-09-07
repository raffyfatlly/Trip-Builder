// Old balances, new unit.
//
// FOUND 2026-09-07 by accident, in a screenshot: "Paid — 7,810 credits are in."
// That figure is from the ORIGINAL scale, where a credit was a hundredth of a
// ringgit of RETAIL and a trip cost about 7,810 of them. A credit is now ten sen
// of real COST, so the same number is worth seventy-eight times more than it was
// when it was granted.
//
// Three scales have existed and every ledger is on whichever one was current
// when it was written:
//
//   original   1 credit = RM0.01 retail      grant 10,000   trip ~7,810
//   middle     1 credit = RM0.31 cost        grant 70       trip ~50
//   now        1 credit = RM0.10 cost        grant 4        trip 27-49
//
// Left alone, the outstanding balances add up to RM825 of API spend that the
// paywall would never stop — including RM781 on one account. Which is exactly
// the promise this pricing was built to keep: "for every rm 28 they spend. i
// will not incur more than RM 10 cost."
//
// WHAT THIS DOES: resets every UNPAID ledger to the current free tier, and
// leaves anything paid for alone. Nobody loses money they spent — nobody has
// spent any yet — and everybody gets a correctly-sized free allowance rather
// than an arbitrary multiple of one.
//
//   node setup/rescale-credits.js          # show what it would do
//   node setup/rescale-credits.js --apply  # do it
import fs from 'fs';
import path from 'path';
import url from 'url';

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  for (const p of [path.resolve(here, '../../claude/meta/keys/trip-builder-firebase.json'),
                   path.resolve(here, '../../../meta/keys/trip-builder-firebase.json')]) {
    if (fs.existsSync(p)) { process.env.FIREBASE_SERVICE_ACCOUNT = fs.readFileSync(p, 'utf8'); break; }
  }
}

const { listLedgers, writeLedger, firestoreConfigured } = await import('../lib/firestore.js');
const { grant, anonGrant, myrPerCredit } = await import('../lib/credits.js');

if (!firestoreConfigured()) { console.error('no service account'); process.exit(1); }
const apply = process.argv.includes('--apply');

const ls = await listLedgers(500);
let before = 0, after = 0, touched = 0;

console.log((apply ? 'APPLYING' : 'DRY RUN') + ' — 1 credit is now RM' + myrPerCredit().toFixed(2) + ' of cost\n');
for (const l of ls) {
  const left = Math.max(0, (l.granted || 0) - (l.used || 0));
  before += left * myrPerCredit();

  // Anything bought is untouchable. Nobody has bought yet, but this script will
  // be run again after somebody has, and a migration that eats paid credit is
  // worse than the problem it fixes.
  if (l.paid === true) {
    after += left * myrPerCredit();
    console.log('  keep   ' + String(l.id).slice(0, 40).padEnd(41) + left + ' credits (paid)');
    continue;
  }

  // A session ledger belongs to somebody not signed in; an account ledger to
  // somebody who is. Different free tiers, same reset.
  const fresh = String(l.id).startsWith('s:') ? anonGrant() : grant();
  if ((l.granted || 0) === fresh && (l.used || 0) === 0) continue;

  touched++;
  after += fresh * myrPerCredit();
  console.log('  reset  ' + String(l.id).slice(0, 40).padEnd(41)
    + (l.granted || 0) + '/' + (l.used || 0) + '  ->  ' + fresh + '/0');
  if (apply) await writeLedger({ ...l, granted: fresh, used: 0, plan: 0, build: 0 });
}

console.log('\n' + touched + ' ledgers ' + (apply ? 'reset' : 'would be reset'));
console.log('outstanding cost liability: RM' + before.toFixed(2) + '  ->  RM' + after.toFixed(2));
if (!apply) console.log('\nnothing written. re-run with --apply');
