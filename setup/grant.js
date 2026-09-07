// Give somebody credits.
//
// raffy, 2026-09-07: "grant syahirah 100 credit."
//
//   node setup/grant.js <email> <credits>     # leave them with that many
//   node setup/grant.js <email> +<credits>    # add on top of what they have
//   node setup/grant.js <email>               # just show me their balance
//
// "Grant 100" is read as **leave them able to spend 100**, not "set the grant
// figure to 100". Somebody sitting at zero who is given a hundred credits
// expects a hundred credits; setting `granted` to 100 against 85 already used
// would hand them fifteen, which is nobody's idea of a grant. Use +N when you
// really do mean "add to the allowance".
//
// Same credential fallback as setup/journal.js: the Firebase service account in
// the vault, so this works from a fresh session with nothing set up.
import fs from 'fs';
import path from 'path';
import url from 'url';

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const vault = path.resolve(here, '../../../meta/keys/trip-builder-firebase.json');
  try {
    if (fs.existsSync(vault)) {
      process.env.FIREBASE_SERVICE_ACCOUNT = fs.readFileSync(vault, 'utf8');
    }
  } catch (e) { /* reported below */ }
}

const { readLedger, writeLedger, firestoreConfigured } = await import('../lib/firestore.js');
const { leftOf, myrPerCredit, markup } = await import('../lib/credits.js');

if (!firestoreConfigured()) {
  console.error('No Firebase service account. Looked for');
  console.error('  meta/keys/trip-builder-firebase.json in the vault, and');
  console.error('  FIREBASE_SERVICE_ACCOUNT in the environment.');
  process.exit(1);
}

const email = String(process.argv[2] || '').trim().toLowerCase();
const arg = String(process.argv[3] || '').trim();
if (!email || !email.includes('@')) {
  console.error('usage: node setup/grant.js <email> [<credits>|+<credits>]');
  process.exit(1);
}

const id = 'u:' + email;
const before = await readLedger(id);
const show = (l, label) => {
  if (!l) return console.log(label + ': no ledger — nothing has been charged to this account');
  console.log(label + ': granted ' + (l.granted || 0)
    + ', used ' + (l.used || 0) + ', left ' + leftOf(l));
};
show(before, 'now');

if (!arg) process.exit(0);

// A ledger that does not exist yet is fine: somebody can be granted credits
// before they have spent anything, and the row is created here.
const l = before || { id, granted: 0, used: 0, plan: 0, build: 0, since: new Date().toISOString() };
const n = Math.round(Number(arg.replace(/^\+/, '')));
if (!isFinite(n) || n <= 0) {
  console.error('give a positive number of credits');
  process.exit(1);
}

const granted = arg.startsWith('+')
  ? (l.granted || 0) + n            // add to the allowance
  : (l.used || 0) + n;              // leave them able to spend exactly n

if (granted === (l.granted || 0)) {
  console.log('nothing to change');
  process.exit(0);
}

const after = await writeLedger({ ...l, id, granted });
show(after, 'after');
console.log('\nThat is ' + leftOf(after) + ' credits to spend — about RM'
  + (leftOf(after) * myrPerCredit()).toFixed(2) + ' of real cost to us, RM'
  + (leftOf(after) * myrPerCredit() * markup()).toFixed(2) + ' at the selling price.');
