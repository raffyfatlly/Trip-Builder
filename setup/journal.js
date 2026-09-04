// Who used it, what happened, and what it cost.
//
// raffy, 2026-09-04: "most importantly i wanna see the cost. cause right now i
// don't place any limitation. then we can study how much does it really coat me
// in average for them to use the app and build their itenary."
//
//   node setup/journal.js              # every session, newest first
//   node setup/journal.js <session>    # one session's timeline
//   node setup/journal.js --csv        # for a spreadsheet
//
// Reads Firestore directly, so it works without the site being up, and finds
// its own credential, so it works without anything being set up.

// raffy, 2026-09-04: "i plan to just ask u for now. not setup anything or check
// myself." A session that has to ask him for a key before it can say what the
// beta is costing has failed at the one thing he wanted.
//
// The environment wins, because a deployment that sets it means it. Failing
// that, the copy kept in the private vault — which is deliberately NOT under
// this directory, since everything here is mirrored to a public repo.
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
  } catch (e) { /* fall through to the message below */ }
}

// Imported after the fallback, because lib/firestore.js reads the environment
// when it is first asked for credentials and caching a miss would defeat this.
const { journalList, journalRead, firestoreConfigured } = await import('../lib/firestore.js');
const { totalUsd } = await import('../lib/journal.js');

if (!firestoreConfigured()) {
  console.error('No Firebase service account.');
  console.error('Looked for meta/keys/trip-builder-firebase.json in the vault,');
  console.error('and FIREBASE_SERVICE_ACCOUNT in the environment.');
  process.exit(1);
}

const arg = process.argv[2] || '';
const money = (n) => '$' + (n || 0).toFixed(4);
const when = (t) => String(t || '').replace('T', ' ').slice(0, 16);

// A build is the expensive thing and the thing he is pricing, so it gets its
// own column rather than being buried in a total.
const built = (j) => (j.lines || []).some((l) => l.ev === 'build.done');

if (arg && arg !== '--csv') {
  const j = await journalRead(arg);
  if (!j) { console.error('no journal for ' + arg); process.exit(1); }
  console.log('session   ' + j.session);
  console.log('started   ' + when(j.started) + '   last ' + when(j.last));
  if (j.dest) console.log('going to  ' + j.dest);
  console.log('errors    ' + (j.errors || 0));
  console.log('');
  for (const k of Object.keys(j.spend || {})) {
    const p = j.spend[k];
    console.log('  ' + k.padEnd(9) + (p.model || '').padEnd(20) +
      String(p.calls).padStart(4) + ' calls  ' +
      'in ' + (p.in || 0).toLocaleString().padStart(10) +
      '  cache ' + (p.cacheRead || 0).toLocaleString().padStart(11) +
      '  out ' + (p.out || 0).toLocaleString().padStart(8) +
      (p.searches ? '  ' + p.searches + ' searches' : '') +
      '  ' + money(p.usd) + (p.priced === 'estimated' ? ' (est)' : ''));
  }
  console.log('  ' + 'TOTAL'.padEnd(9) + ' '.repeat(20) + ' '.repeat(12) + '  ' +
    ' '.repeat(31) + money(totalUsd(j)) + '   RM' + (totalUsd(j) * 4.4).toFixed(2));
  console.log('');
  for (const l of j.lines || []) {
    const extra = Object.keys(l).filter((k) => k !== 't' && k !== 'ev')
      .map((k) => k + '=' + l[k]).join('  ');
    console.log('  ' + when(l.t) + '  ' + String(l.ev).padEnd(16) + extra);
  }
  process.exit(0);
}

const all = await journalList(300);
if (!all.length) { console.log('nothing logged yet'); process.exit(0); }

if (arg === '--csv') {
  console.log('session,started,last,dest,usd,built,errors,turns');
  for (const j of all) {
    console.log([j.session, j.started, j.last, JSON.stringify(j.dest || ''),
      totalUsd(j).toFixed(4), built(j) ? 1 : 0, j.errors || 0,
      (j.lines || []).filter((l) => l.ev === 'msg').length].join(','));
  }
  process.exit(0);
}

console.log('');
console.log('  ' + 'SESSION'.padEnd(32) + 'LAST'.padEnd(18) + 'GOING TO'.padEnd(18) +
  'TURNS'.padStart(6) + 'BUILT'.padStart(7) + 'ERR'.padStart(5) + 'COST'.padStart(10));
for (const j of all) {
  console.log('  ' + String(j.session).padEnd(32) +
    when(j.last).padEnd(18) +
    String(j.dest || '').slice(0, 17).padEnd(18) +
    String((j.lines || []).filter((l) => l.ev === 'msg').length).padStart(6) +
    (built(j) ? '  yes' : '   no').padStart(7) +
    String(j.errors || 0).padStart(5) +
    money(totalUsd(j)).padStart(10));
}

const total = all.reduce((a, j) => a + totalUsd(j), 0);
const builds = all.filter(built);
const buildCost = builds.reduce((a, j) => a + totalUsd(j), 0);

console.log('');
console.log('  ' + all.length + ' sessions, ' + builds.length + ' of them built an itinerary');
console.log('  spent      ' + money(total) + '   RM' + (total * 4.4).toFixed(2));
if (all.length) console.log('  per session' + money(total / all.length).padStart(11));
// The number he actually asked for.
if (builds.length) {
  console.log('  per trip   ' + money(buildCost / builds.length) +
    '   RM' + ((buildCost / builds.length) * 4.4).toFixed(2) + '  <- average cost of one itinerary');
}
console.log('');
