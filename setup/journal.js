// Who used it, what happened, and what it cost.
//
// raffy, 2026-09-04: "most importantly i wanna see the cost. cause right now i
// don't place any limitation. then we can study how much does it really coat me
// in average for them to use the app and build their itenary."
//
//   node setup/journal.js              # everything: sessions, services, people, pricing
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

const everything = await journalList(300);
if (!everything.length) { console.log('nothing logged yet'); process.exit(0); }

// The house ledger is spend with no session behind it — serving photos out of
// itineraries that have already been shared, mostly. It is real money and part
// of the total, but it is not a session and must never be averaged as one.
const all = everything.filter((j) => !j.house);
const houses = everything.filter((j) => j.house);
const houseUsd = houses.reduce((a, j) => a + totalUsd(j), 0);

if (arg === '--csv') {
  console.log('session,started,last,dest,usd,built,errors,turns');
  for (const j of everything) {
    console.log([j.session, j.started, j.last, JSON.stringify(j.dest || ''),
      totalUsd(j).toFixed(4), built(j) ? 1 : 0, j.errors || 0,
      (j.lines || []).filter((l) => l.ev === 'msg').length].join(','));
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// The report.
//
// raffy, 2026-09-04: "find a way so that we can track everything not just agent
// but all the services we use. per person, with real insights that could help
// us monitor and decide how to price our service in future."
//
// So four questions, in the order they need answering:
//   1. what happened          — the session list
//   2. where does money go    — per service, so a rate change has an owner
//   3. who spends it          — per person, because that is what gets priced
//   4. what does a trip cost  — the distribution, not the average
// ---------------------------------------------------------------------------

const RM = (n) => 'RM' + (n * 4.4).toFixed(2);
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

console.log('');
console.log('  ' + 'SESSION'.padEnd(32) + 'WHO'.padEnd(26) + 'LAST'.padEnd(18) +
  'GOING TO'.padEnd(16) + 'TURNS'.padStart(6) + 'BUILT'.padStart(7) + 'ERR'.padStart(5) + 'COST'.padStart(10));
for (const j of all) {
  console.log('  ' + pad(String(j.session).slice(0, 31), 32) +
    pad(String(j.who || '\u2014').slice(0, 25), 26) +
    pad(when(j.last), 18) +
    pad(String(j.dest || '').slice(0, 15), 16) +
    rpad((j.lines || []).filter((l) => l.ev === 'msg').length, 6) +
    rpad(built(j) ? 'yes' : 'no', 7) +
    rpad(j.errors || 0, 5) +
    rpad(money(totalUsd(j)), 10));
}

const sessionUsd = all.reduce((a, j) => a + totalUsd(j), 0);
const total = sessionUsd + houseUsd;
const builds = all.filter(built);

// ---- 2. where the money goes ----------------------------------------------
//
// Every service the app touches, whether or not anybody remembered to price it.
// A row at $0.0000 with a lot of calls is not noise: it is either genuinely
// free or a rate we have not looked up, and the `?` column says which.
const svc = new Map();
for (const j of everything) {
  for (const k of Object.keys(j.spend || {})) {
    const p = j.spend[k];
    const r = svc.get(k) || { usd: 0, calls: 0, failed: 0, sessions: 0, unknown: false, how: '' };
    r.usd += p.usd || 0;
    r.calls += p.calls || 0;
    r.failed += p.failed || 0;
    r.sessions++;
    if (p.unknown) r.unknown = true;
    // Worst case wins: one estimated session makes the whole row an estimate,
    // because that is what the number is then worth.
    const how = p.unknown ? 'not priced yet' : p.priced === 'estimated' ? 'estimated from tokens'
      : p.priced === 'provider' ? "provider's own figure"
      : p.usd ? 'our rate card' : 'free';
    const rank = ['free', "provider's own figure", 'our rate card', 'estimated from tokens', 'not priced yet'];
    if (rank.indexOf(how) > rank.indexOf(r.how || 'free')) r.how = how;
    svc.set(k, r);
  }
}
const rows = [...svc.entries()].sort((a, b) => b[1].usd - a[1].usd);

console.log('');
console.log('  WHERE THE MONEY GOES');
console.log('  ' + 'SERVICE'.padEnd(18) + 'CALLS'.padStart(8) + 'FAILED'.padStart(8) +
  'SESSIONS'.padStart(10) + 'SPENT'.padStart(11) + 'SHARE'.padStart(8) + '  HOW PRICED');
for (const [k, r] of rows) {
  console.log('  ' + pad(k, 18) + rpad(r.calls.toLocaleString('en'), 8) +
    rpad(r.failed || '', 8) + rpad(r.sessions, 10) + rpad(money(r.usd), 11) +
    rpad(total ? (100 * r.usd / total).toFixed(1) + '%' : '', 8) +
    '  ' + r.how);
}
const unpriced = rows.filter(([, r]) => r.unknown);
if (unpriced.length) {
  console.log('');
  console.log('  ' + unpriced.length + ' service(s) are being called and counted but not priced.');
  console.log('  Add them to BOOK in lib/meter.js with a rate and they start showing real money.');
}

// ---- 3. per person ---------------------------------------------------------
//
// The unit that gets charged is a person, not a session — somebody who opens
// four sessions to plan one trip costs what all four cost.
const ppl = new Map();
for (const j of all) {
  const who = j.who || '(not signed in)';
  const r = ppl.get(who) || { sessions: 0, trips: 0, usd: 0, errors: 0, first: '', last: '' };
  r.sessions++;
  if (built(j)) r.trips++;
  r.usd += totalUsd(j);
  r.errors += j.errors || 0;
  if (!r.first || String(j.started || '') < r.first) r.first = String(j.started || '');
  if (String(j.last || '') > r.last) r.last = String(j.last || '');
  ppl.set(who, r);
}
const people = [...ppl.entries()].sort((a, b) => b[1].usd - a[1].usd);

console.log('');
console.log('  PER PERSON');
console.log('  ' + 'WHO'.padEnd(30) + 'SESSIONS'.padStart(9) + 'TRIPS'.padStart(7) +
  'ERR'.padStart(5) + 'SPENT'.padStart(11) + 'PER TRIP'.padStart(11) + '   SINCE');
for (const [who, r] of people) {
  console.log('  ' + pad(who.slice(0, 29), 30) + rpad(r.sessions, 9) + rpad(r.trips, 7) +
    rpad(r.errors || '', 5) + rpad(money(r.usd), 11) +
    rpad(r.trips ? money(r.usd / r.trips) : '\u2014', 11) + '   ' + when(r.first).slice(0, 10));
}
const anon = ppl.get('(not signed in)');
if (anon && all.length) {
  const share = Math.round(100 * anon.sessions / all.length);
  if (share >= 20) {
    console.log('');
    console.log('  ' + share + '% of sessions are not signed in, so that much of the spend has no');
    console.log('  person against it. Per-person pricing needs sign-in earlier than it happens now.');
  }
}

// ---- 4. what a trip costs --------------------------------------------------
//
// The mean is the number that gets quoted and the wrong one to price against:
// one runaway session drags it up, and pricing to the mean still loses money on
// the half of trips above it. p90 is the honest question — what covers nine
// trips in ten — and the gap between p50 and p90 is how much variance the
// pricing has to absorb.
const costs = builds.map(totalUsd).sort((a, b) => a - b);
const at = (q) => costs.length ? costs[Math.min(costs.length - 1, Math.floor(q * costs.length))] : 0;

console.log('');
console.log('  WHAT A TRIP COSTS   (' + costs.length + ' built' +
  (all.length - builds.length ? ', ' + (all.length - builds.length) + ' session(s) never built one' : '') + ')');
if (!costs.length) {
  console.log('  Nothing built yet. Nothing to price.');
} else {
  const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
  const show = (label, v, tail) => console.log('  ' + pad(label, 12) + rpad(money(v), 11) +
    rpad(RM(v), 11) + (tail ? '   ' + tail : ''));
  show('cheapest', costs[0]);
  show('median', at(0.5), 'half of trips cost less than this');
  show('mean', mean, 'what gets quoted, and not what to price on');
  show('p90', at(0.9), 'covers 9 trips in 10  <- price above this');
  show('dearest', costs[costs.length - 1], 'the one that would have hurt');
  if (costs.length < 8) {
    console.log('');
    console.log('  ' + costs.length + ' trips is too few for p90 to mean anything. Treat these as a');
    console.log('  first look, not a basis for a price.');
  }
}

// Sessions that spent money and produced nothing are pure loss, and the reason
// a per-trip price can be right and the business still be wrong.
const wasted = all.filter((j) => !built(j)).reduce((a, j) => a + totalUsd(j), 0);

// --- the ledger ------------------------------------------------------------
//
// raffy, 2026-09-05: "really plan the cost so that like i said im safe and have
// some profit. 3-5 x minimum."
//
// The per-action markup is a setting. Whether the BUSINESS is at 3-5x is a
// different question, and this is where it gets answered: what has actually
// been given away, what it actually cost, and what the blend comes to. A
// markup that is right per action and wrong in aggregate is the failure mode
// the pricing note warned about.
{
  const { listLedgers } = await import('../lib/firestore.js');
  const C = await import('../lib/credits.js');
  const cfg = C.explain();
  let ledgers = [];
  try { ledgers = await listLedgers(400); } catch (e) { /* none yet */ }

  console.log('  THE LEDGER');
  console.log('  markup ' + cfg.markup + 'x   1 credit = RM0.01   '
    + 'signed-in grant ' + cfg.grant.toLocaleString('en') + ' (RM' + cfg.grantWorthMyr
    + ' retail, RM' + cfg.grantCostsMyr + ' of real cost)   anonymous ' + cfg.anonGrant.toLocaleString('en'));

  if (!ledgers.length) {
    console.log('  nobody has spent a credit yet.');
  } else {
    const users = ledgers.filter((l) => l.id.startsWith('u:'));
    const anon = ledgers.filter((l) => l.id.startsWith('s:'));
    console.log('');
    console.log('  WHO' + ' '.repeat(29) + 'GRANTED     USED     LEFT   REAL COST   AT RETAIL');
    for (const l of ledgers.sort((a, b) => b.used - a.used).slice(0, 25)) {
      const who = l.id.startsWith('u:') ? l.id.slice(2) : 'anonymous ' + l.id.slice(2, 14) + '…';
      console.log('  ' + who.slice(0, 30).padEnd(30)
        + String(l.granted).padStart(7) + String(l.used).padStart(9)
        + String(Math.max(0, l.granted - l.used)).padStart(9)
        + ('RM' + C.costMyr(l.used).toFixed(2)).padStart(12)
        + ('RM' + C.retailMyr(l.used).toFixed(2)).padStart(12));
    }
    const usedCredits = ledgers.reduce((a, l) => a + l.used, 0);
    const outstanding = ledgers.reduce((a, l) => a + Math.max(0, l.granted - l.used), 0);
    console.log('');
    console.log('  ' + users.length + ' signed-in, ' + anon.length + ' anonymous');
    console.log('  given away   ' + usedCredits.toLocaleString('en') + ' credits   '
      + 'RM' + C.retailMyr(usedCredits).toFixed(2) + ' of retail value, which cost RM'
      + C.costMyr(usedCredits).toFixed(2) + ' to serve');
    console.log('  still owed   ' + outstanding.toLocaleString('en') + ' credits   '
      + 'worst case another RM' + C.costMyr(outstanding).toFixed(2) + ' if every grant is spent to the last credit');

    // The number the 3-5x floor is actually about. Charged credits against
    // what the sessions really cost — not against the rate card, which is
    // right by construction and therefore proves nothing.
    const charged = all.reduce((a, j) => a + (Number(j.chargedCredits) || 0), 0);
    const chargedUsd = all.reduce((a, j) => a + (Number(j.chargedUsd) || 0), 0);
    if (chargedUsd > 0.0001) {
      const blended = C.retailMyr(charged) / (chargedUsd * 4.4);
      console.log('  blended      ' + blended.toFixed(2) + 'x   '
        + (blended >= 3 ? 'inside his 3-5x floor' : '*** BELOW THE 3x FLOOR ***'));
    }
    const unbilled = total - chargedUsd;
    if (unbilled > 0.01) {
      console.log('  unbilled     ' + money(unbilled) + '   ' + RM(unbilled)
        + '   spent before the ledger existed, or by sessions with nobody attached');
    }
  }
  console.log('');
}

console.log('');
console.log('  ' + all.length + ' sessions, ' + builds.length + ' of them built an itinerary, ' +
  people.filter(([w]) => w !== '(not signed in)').length + ' known people');
console.log('  spent        ' + money(total) + '   ' + RM(total));
if (houseUsd > 0.0001) {
  console.log('  of that      ' + money(houseUsd) + '   ' + RM(houseUsd) +
    '   serving photos out of trips already shared, no session to bill');
}
if (all.length) console.log('  per session  ' + money(sessionUsd / all.length) + '   ' + RM(sessionUsd / all.length));
if (wasted > 0.0001) {
  console.log('  abandoned    ' + money(wasted) + '   ' + RM(wasted) + '   ' +
    Math.round(100 * wasted / sessionUsd) + '% of session spend went on sessions that never built anything');
}
console.log('');
