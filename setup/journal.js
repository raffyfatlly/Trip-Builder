// Who used it, what happened, and what it cost.
//
// raffy, 2026-09-04: "most importantly i wanna see the cost. cause right now i
// don't place any limitation. then we can study how much does it really coat me
// in average for them to use the app and build their itenary."
//
//   node --env-file=.env setup/journal.js              # every session, newest first
//   node --env-file=.env setup/journal.js <session>    # one session's timeline
//   node --env-file=.env setup/journal.js --csv        # for a spreadsheet
//
// Reads Firestore directly, so it works from anywhere the service account key
// is, without the site being up.

import { journalList, journalRead, firestoreConfigured } from '../lib/firestore.js';
import { totalUsd } from '../lib/journal.js';

if (!firestoreConfigured()) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set. Run with --env-file=.env');
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
      '  out ' + (p.out || 0).toLocaleString().padStart(8) +
      '  ' + money(p.usd));
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
console.log('  ' + 'SESSION'.padEnd(20) + 'LAST'.padEnd(18) + 'GOING TO'.padEnd(20) +
  'TURNS'.padStart(6) + 'BUILT'.padStart(7) + 'ERR'.padStart(5) + 'COST'.padStart(10));
for (const j of all) {
  console.log('  ' + String(j.session).slice(0, 19).padEnd(20) +
    when(j.last).padEnd(18) +
    String(j.dest || '').slice(0, 19).padEnd(20) +
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
