// The arranging phase: the To do list.
//
// raffy, 2026-09-01: "i want to add like a to do list . this includes things
// like purchase flight ticket etc etc or book hotel" — asked three hours after
// shipping the Wallet's "Still to sort" section, and not recognising it.
//
// That was the diagnosis. The checklist and the wallet are ONE object in TWO
// states, and the tab is named after the job now rather than the container.
//
//   node setup/test-todo.mjs
//   BASE=http://localhost:3220 node setup/test-todo.mjs   (also checks the tab)

import { checklist, dueIn, linkFor } from '../lib/checklist.js';
import { applyEdits } from '../lib/edits.js';
import { toEdits } from '../lib/editTools.js';
import { flightSearchLink, hotelSearchLink, checkPrices } from '../lib/prices.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const soon = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
const later = new Date(Date.now() + 47 * 86400000).toISOString().slice(0, 10);
const trip = () => ({
  trip: { start: soon, end: later, title: 'Rome', travellers: [{ name: 'A' }, { name: 'B' }] },
  stays: [{ n: 'Hotel Artemide' }],
  days: [{ dow: 'Wed', dom: '14', items: [
    { _id: 'x', h: 'Colosseum', tags: ['Book ahead'] },
    { _id: 'y', h: "Jumu'ah", tags: ['Confirm in advance'] },
    { _id: 'z', h: 'Coffee' },
  ] }],
});

// --- what a plan implies about itself --------------------------------------
const base = checklist(trip());
ok('the plan writes its own list', base.todo.length === 3, base.todo.map((t) => t.what).join(' | '));
ok('flights first', base.todo[0].kind === 'flight');
ok('sorted by deadline, not by kind',
   base.todo.every((t, i) => i === 0 || t.by >= base.todo[i - 1].by),
   base.todo.map((t) => t.by).join(' '));

// A looser tag pattern matched "Confirm in advance" on Friday prayers and put
// "Book Jumu'ah" on the list. A task nobody can act on costs more than one
// that is missing.
ok('it does not invent a booking for something you cannot book',
   !base.todo.some((t) => /Jumu/.test(t.what)), base.todo.map((t) => t.what).join(' | '));
ok('and leaves ordinary items alone', !base.todo.some((t) => /Coffee/.test(t.what)));

// --- the collapsing-deadline problem ---------------------------------------
//
// Departure minus lead time, floored at today, puts EVERY task on today the
// moment a trip is closer than the longest lead — which is most real trips.
// Six rows all shouting "do this now" carry no information.
const tight = checklist({ ...trip(), trip: { ...trip().trip, start: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10) } });
const dues = tight.todo.map((t) => t.by);
ok('a close trip still spreads its deadlines', new Set(dues).size > 1, dues.join(' '));
ok('and keeps the same order', tight.todo[0].kind === 'flight');
ok('nothing is due in the past', dues.every((d) => d >= new Date().toISOString().slice(0, 10)));

// --- one object, two states -------------------------------------------------
const filed = checklist(applyEdits(trip(), [
  { type: 'booking.set', id: 'bk1', booking: { kind: 'stay', title: 'Artemide', stay: 0 }, ts: 1 },
]));
ok('filing a booking ticks its task', filed.done.some((t) => /Artemide/.test(t.what)));
ok('and takes it off the list', !filed.todo.some((t) => /Artemide/.test(t.what)));

// Ticking by hand must not erase the task it ticks: an op carrying only
// {done:true} once replaced the derived task, so the stay vanished entirely
// instead of moving to done.
const ticked = checklist(applyEdits(trip(), toEdits([{ op: 'tick_task', id: 'd:stay0' }], 1)));
ok('ticking one off keeps its name', ticked.done.some((t) => /Artemide/.test(t.what)),
   JSON.stringify(ticked.done));

const added = checklist(applyEdits(trip(), toEdits([{ op: 'add_task', task: {
  what: 'Apply for the Schengen visa', kind: 'visa', by: soon, why: '15 working days',
} }], 1)));
ok('the agent can add what a plan cannot imply', added.todo.some((t) => /Schengen/.test(t.what)));

// --- every task carries the thing that finishes it --------------------------
process.env.TRAVELPAYOUTS_MARKER = 'TESTMARKER';
const it = trip();
const links = checklist(it).todo.map((t) => linkFor(t, it));
ok('every task has a link', links.every(Boolean), links.filter((l) => !l).length + ' missing');
// Nobody has told us the airports yet, which is the normal state for someone
// who has booked nothing. A plain web search would be a poor answer to the
// most important row on the list, so it falls through to Google Flights.
ok('an unknown route still lands on real fares', /travel\/flights\?q=/.test(links[0]), links[0]);

// Once the agent supplies the codes, the row becomes a dated affiliate search.
const withRoute = (() => {
  const t2 = applyEdits(trip(), toEdits([{ op: 'add_task', id: 'd:flights',
    task: { route: { from: 'KUL', to: 'FCO' } } }], 1));
  const c = checklist(t2);
  const f = c.todo.find((x) => x.kind === 'flight');
  return { task: f, link: linkFor(f, t2) };
})();
ok('the agent can fill in the airports', !!withRoute.task && withRoute.task.what === 'Book the flights',
   JSON.stringify(withRoute.task && withRoute.task.what));
ok('and then it is a real dated fare search',
   /aviasales\.com\/search\/KUL\d{4}FCO/.test(withRoute.link), withRoute.link);
ok('carrying the affiliate marker', withRoute.link.includes('marker=TESTMARKER'));
ok('without adding a second flight row',
   checklist(applyEdits(trip(), toEdits([{ op: 'add_task', id: 'd:flights',
     task: { route: { from: 'KUL', to: 'FCO' } } }], 1))).all.filter((t) => t.kind === 'flight').length === 1);
ok('the room link carries dates and the marker',
   links[1].includes('checkIn=') && links[1].includes('marker=TESTMARKER'), links[1]);

ok('a deadline reads like a person said it', dueIn(new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)) === 'this week');
ok('and an overdue one is blunt', dueIn('2020-01-01') === 'do this now');

// --- prices, with nothing configured ---------------------------------------
delete process.env.TRAVELPAYOUTS_TOKEN;
const noTok = await checkPrices({ flights: [{ from: 'KUL', to: 'FCO', date: soon }] });
ok('without a token it refuses to quote', /cannot quote a fare/i.test(noTok));
ok('and forbids the estimate outright', /do NOT estimate/i.test(noTok));
ok('but still hands over a real search link', noTok.includes('aviasales.com/search/'), noTok.split('\n').pop());
ok('an empty request is answered, not thrown', (await checkPrices({})) === 'Nothing to price.');
ok('a link needs real IATA codes', flightSearchLink({ from: 'Kuala Lumpur', to: 'Rome', date: soon }) === '');
ok('and a hotel link needs somewhere to go', hotelSearchLink({ where: '' }) === '');

// --- what the agent is told --------------------------------------------------
const { SYSTEM: P } = await import('../lib/prompt.js');
ok('the prompt explains the arranging phase', /three phases/i.test(P) && P.includes('To do'));
ok('and that most of the list writes itself', /writes itself/i.test(P));
ok('and not to pad it', /Do not pad it/.test(P));
ok('and never to estimate a fare', /Never estimate a fare/.test(P));
ok('and that pace changes every day of the trip', /changes every single day/.test(P));
ok('the prompt still parses whole', P.length > 25000, P.length + ' chars');

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
