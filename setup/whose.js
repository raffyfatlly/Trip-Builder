// Who has used the app, and what each of them cost.
//
// raffy, 2026-09-07: "look at my wife account syahirah, she did a Singapore
// trip. i want to know how much it really cost us in total against the 70
// credit we gave."
//
// setup/journal.js answers "what did this SESSION cost". This answers "what did
// this PERSON cost", which is a different question once somebody has more than
// one session — and it is the question that matters for whether the free grant
// is set at the right level.
//
//   node setup/whose.js            # everyone, with their balance
//   node setup/whose.js <text>     # just the accounts matching that
//
// Same credential fallback as setup/journal.js, for the same reason.
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

const { journalList, readLedger, listLedgers, readAccount, journalRead, firestoreConfigured } = await import('../lib/firestore.js');
const { totalUsd } = await import('../lib/journal.js');
const { creditsFor, grant, myrPerCredit, markup, leftOf } = await import('../lib/credits.js');

if (!firestoreConfigured()) {
  console.error('No Firebase service account. Looked for');
  console.error('  meta/keys/trip-builder-firebase.json in the vault, and');
  console.error('  FIREBASE_SERVICE_ACCOUNT in the environment.');
  process.exit(1);
}

// `--raw <session>` dumps the billing fields of one journal, which is the only
// way to see WHO a session was charged to and how much was actually taken —
// setup/journal.js prints what a session cost, not what was billed for it, and
// when those two disagree that difference is the whole story.
if (process.argv[2] === '--raw') {
  const j = await journalRead(process.argv[3] || '');
  if (!j) { console.log('no journal for that session'); process.exit(0); }
  console.log(JSON.stringify({
    session: j.session, who: j.who, started: j.started, last: j.last,
    realUsd: +totalUsd(j).toFixed(4),
    realCredits: creditsFor(totalUsd(j)),
    chargedUsd: j.chargedUsd, chargedCredits: j.chargedCredits,
    capped: j.capped,
  }, null, 1));
  process.exit(0);
}

const want = (process.argv[2] || '').toLowerCase();
const all = await journalList(500);

// Group the sessions by the account that owns them.
const people = new Map();
for (const j of all) {
  const who = j.who || '(not signed in)';
  if (!people.has(who)) people.set(who, []);
  people.get(who).push(j);
}

const money = (n) => '$' + Number(n).toFixed(4);
const rows = [...people.entries()]
  .filter(([who]) => !want || who.toLowerCase().includes(want))
  .sort((a, b) => b[1].length - a[1].length);

if (!rows.length) {
  console.log(want ? 'Nobody matching "' + process.argv[2] + '".' : 'No sessions at all.');
  console.log('\nEveryone the journal knows about:');
  for (const who of people.keys()) console.log('  ' + who);
  process.exit(0);
}

for (const [who, sessions] of rows) {
  const usd = sessions.reduce((a, j) => a + totalUsd(j), 0);
  const credits = creditsFor(usd);
  console.log('\n' + who);
  console.log('  ' + sessions.length + ' session' + (sessions.length > 1 ? 's' : '')
    + '   real cost ' + money(usd)
    + '   = ' + credits + ' credits of the ' + grant() + ' granted');

  // The ledger is what the app actually charged, which can differ from the
  // journal total: a session that was never settled has spent money nobody
  // has been billed for yet.
  try {
    const l = await readLedger('u:' + who);
    if (l) {
      console.log('  ledger: granted ' + (l.granted || 0)
        + ', used ' + (l.used || 0) + ', left ' + leftOf(l)
        + '   (planning ' + (l.plan || 0) + ', building ' + (l.build || 0) + ')');
    } else {
      console.log('  ledger: none — nothing has been charged to this account');
    }
  } catch (err) {
    console.log('  ledger: could not read (' + (err.message || err) + ')');
  }

  for (const j of sessions.sort((a, b) => String(a.started).localeCompare(String(b.started)))) {
    const t = totalUsd(j);
    console.log('    ' + j.session + '  ' + String(j.started).slice(0, 16).replace('T', ' ')
      + '  ' + money(t).padStart(9) + '  ' + creditsFor(t) + 'cr');
  }
}

// Every ledger, including accounts that have a balance but no journal yet.
//
// The journal only has a row once a session SPENDS something, so somebody who
// signed up and was granted credits shows up here and nowhere else. That gap is
// exactly what made "which account is my wife's" unanswerable from the journal
// alone.
console.log('\n\nEVERY LEDGER');
try {
  const ls = await listLedgers(300);
  if (!ls.length) console.log('  none');
  for (const l of ls.sort((a, b) => (b.used || 0) - (a.used || 0))) {
    console.log('  ' + String(l.id || '(no id)').padEnd(34)
      + ' granted ' + String(l.granted || 0).padStart(6)
      + '   used ' + String(l.used || 0).padStart(6)
      + '   left ' + String(leftOf(l)).padStart(6)
      + '   plan ' + String(l.plan || 0).padStart(5)
      + '   build ' + String(l.build || 0).padStart(5));
  }
} catch (err) {
  console.log('  could not list ledgers: ' + (err.message || err));
}

// The trips each account actually holds, and what each of those sessions cost.
//
// A ledger says what somebody was charged; it does not say what they were
// doing. The account record holds their trips, and the journal holds the cost
// of each session — joining the two is the only way to answer "what did my
// wife's Singapore trip cost", which was the question that started this file.
console.log('\n\nWHAT EACH ACCOUNT HAS');
for (const l of (await listLedgers(300)).filter((x) => String(x.id || '').startsWith('u:'))) {
  const email = String(l.id).slice(2);
  console.log('\n  ' + email);
  let acct = null;
  try { acct = await readAccount(email); } catch (err) { console.log('    account unreadable'); }
  if (!acct || !(acct.trips || []).length) { console.log('    no trips on the account record'); continue; }
  for (const t of acct.trips) {
    let cost = null;
    try {
      const j = await journalRead(t.id);
      if (j) cost = totalUsd(j);
    } catch (err) { /* a trip with no journal is a trip that never spent */ }
    console.log('    ' + String(t.label || '(untitled)').padEnd(28)
      + ' ' + t.id
      + (cost === null ? '   no journal row' : '   ' + money(cost) + '  ' + creditsFor(cost) + 'cr'));
  }
}

console.log('\n1 credit = RM' + myrPerCredit() + ' of real cost, sold at '
  + markup() + 'x (RM' + (myrPerCredit() * markup()).toFixed(2) + ').');
