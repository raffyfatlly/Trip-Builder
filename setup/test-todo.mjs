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

import { checklist, dueIn, linkFor, isOwn } from '../lib/checklist.js';
import { applyEdits } from '../lib/edits.js';
import { toEdits } from '../lib/editTools.js';
import { flightSearchLink, hotelSearchLink, checkPrices } from '../lib/prices.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const soon = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
const later = new Date(Date.now() + 47 * 86400000).toISOString().slice(0, 10);
const trip = () => ({
  trip: { start: soon, end: later, title: 'Rome', travellers: [{ name: 'A' }, { name: 'B' }] },
  // draft:true is what an unbooked stay looks like. Its absence means booked —
  // that is how the rest of the app reads it — so a fixture that omits it is
  // describing a trip where the hotel is already sorted.
  stays: [{ n: 'Hotel Artemide', draft: true }],
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
ok('without a token it refuses to quote', /cannot quote a rate/i.test(noTok));
ok('and forbids the estimate outright', /do NOT estimate/i.test(noTok));
// "Do not estimate" was not enough on its own: told it could not quote, the
// agent web-searched nightly rates and put aggregator numbers on the cards as
// if they were the hotel's price — one of them for a different property in the
// same town. A rate scraped from a search result is not a live rate.
ok('and closes the web-search loophole too', /do NOT go and find one by web search/i.test(noTok));
ok('and points at the hotel\'s own page for one property', /place_details/i.test(noTok));
ok('but still hands over a real search link', noTok.includes('aviasales.com/search/'), noTok.split('\n').pop());
ok('an empty request is answered, not thrown', (await checkPrices({})) === 'Nothing to price.');
ok('a link needs real IATA codes', flightSearchLink({ from: 'Kuala Lumpur', to: 'Rome', date: soon }) === '');
ok('and a hotel link needs somewhere to go', hotelSearchLink({ where: '' }) === '');

// --- what the agent is told --------------------------------------------------
const { SYSTEM: P } = await import('../lib/prompt.js');
ok('the prompt explains the arranging phase', /three phases/i.test(P) && P.includes('To do'));
ok('and that a price search takes a town, not a hotel name',
   /never a hotel name/i.test(P) && /different town/i.test(P));
ok('and not to go hunting a rate by web search when it cannot quote one',
   /do not go and find a rate by web search/i.test(P));
ok('and that most of the list writes itself', /writes itself/i.test(P));
ok('and not to pad it', /Do not pad it/.test(P));
ok('and never to estimate a fare', /Never estimate a fare/.test(P));
ok('and that pace changes every day of the trip', /changes every single day/.test(P));
ok('the prompt still parses whole', P.length > 25000, P.length + ' chars');


// --- getting there is only a task if they arrange it ------------------------
//
// raffy, 2026-09-01: "if the trip doesn't involve flight , do not put confirm
// the flights." A list with one wrong item on it is a list people stop
// trusting, and a trip somebody drives to does not want a flight row.
{
  const how = (arriveBy) => checklist({ ...trip(), trip: { ...trip().trip, arriveBy } })
    .todo.map((t) => t.what);
  console.log('');
  ok('a flown trip books flights', how('fly').some((w) => /flights/i.test(w)));
  ok('and so does one that never said', how(undefined).some((w) => /flights/i.test(w)));
  ok('a driven trip does not', !how('drive').some((w) => /flight/i.test(w)), how('drive').join(' | '));
  ok('and is not told to sort a car it already owns',
     !how('drive').some((w) => /getting there|car/i.test(w)), how('drive').join(' | '));
  ok('a train trip books the train', how('train').some((w) => /train/i.test(w)), how('train').join(' | '));
  // Seats on a good departure go before hotel rooms do.
  ok('and books it before the room', /train/i.test(how('train')[0]), how('train').join(' | '));
}


// --- the list agrees with the rest of the app -------------------------------
//
// raffy, 2026-09-01: "in other pages for example the hotels already noted as
// booked or confirmed , but im the to do page itself , the list doesn't move
// from still to do to confirmed?"
//
// It was only reading filed bookings, so confirming a stay any other way — the
// agent's confirm_stay, a booking naming no index — left the row sitting there
// contradicting the page next to it.
{
  const t = trip();
  t.stays = [{ n: 'Hotel Artemide', draft: false }];
  console.log('');
  ok('a stay the app calls booked is off the list',
     !checklist(t).todo.some((x) => /Artemide/.test(x.what)), checklist(t).todo.map((x) => x.what).join(' | '));
  ok('and shows as done instead', checklist(t).done.some((x) => /Artemide/.test(x.what)));

  const draft = trip();
  draft.stays = [{ n: 'Hotel Artemide', draft: true }];
  ok('one still a draft stays on it', checklist(draft).todo.some((x) => /Artemide/.test(x.what)));
}

// --- their list, so they can change it --------------------------------------
//
// raffy: "we should let user to add and and delete their own to do . like some
// other things like enable roaming or buy e sim etc."
{
  const dropped = applyEdits(trip(), toEdits([{ op: 'drop_task', id: 'd:flights' }], 1));
  ok('a task can be taken off outright',
     !checklist(dropped).todo.some((x) => /flight/i.test(x.what)),
     checklist(dropped).todo.map((x) => x.what).join(' | '));
  ok('and it does not come back as done either',
     !checklist(dropped).done.some((x) => /flight/i.test(x.what)));
  ok('the rest of the list is untouched', checklist(dropped).todo.length === checklist(trip()).todo.length - 1);

  const mine = applyEdits(trip(), toEdits([{ op: 'add_task', task: {
    what: 'Buy an eSIM', kind: 'admin', why: 'Cheaper than roaming and it works the moment you land.',
  } }], 1));
  ok('and they can add one of their own', checklist(mine).todo.some((x) => /eSIM/.test(x.what)));
}

// --- a filed confirmation closes the row it confirms -------------------------
//
// The duplicate this whole file exists to prevent, found on screen: "Book
// Furama Resort Danang" still sitting in the list with a booking titled
// "Furama Resort Danang" filed beside it under Sorted. A confirmation is
// matched by task id when the agent sends one and by the name of the thing
// when it does not, because what actually arrives is a booking email.
{
  console.log('');
  const t = trip();
  t.bookings = [{ id: 'bk1', kind: 'activity', title: 'Colosseum', ref: 'CL-99' }];
  const c = checklist(t);
  ok('a confirmation named after the thing ticks its row off',
     !c.todo.some((x) => /Colosseum/.test(x.what)), c.todo.map((x) => x.what).join(' | '));
  ok('and the thing appears once, not twice',
     c.done.filter((x) => /Colosseum/i.test(x.what)).length === 1
     && !c.extra.some((b) => /Colosseum/i.test(b.title)),
     'done ' + c.done.length + ' extra ' + c.extra.length);
  ok('with its reference on the row it closed',
     (c.done.find((x) => /Colosseum/.test(x.what)) || {}).booking?.ref === 'CL-99');

  const byId = trip();
  byId.bookings = [{ id: 'bk2', kind: 'flight', title: 'AK 1494', task: 'd:flights', ref: 'ZZ1' }];
  ok('and an id closes it outright', !checklist(byId).todo.some((x) => /flight/i.test(x.what)));

  // Forgiving, not credulous: a short or unrelated title must not swallow a row.
  const other = trip();
  other.bookings = [{ id: 'bk3', kind: 'other', title: 'Airport parking' }];
  ok('an unrelated confirmation closes nothing',
     checklist(other).todo.length === checklist(trip()).todo.length,
     checklist(other).todo.map((x) => x.what).join(' | '));
  ok('and is still filed, not lost', checklist(other).extra.length === 1);
}

// --- their own list is not a booking list ------------------------------------
//
// raffy, 2026-09-02: "for their own to do they don't need that book link .
// cause it can be as random as call my mum or whatever right."
//
// The link fell back to a Google search for "<whatever> booking", which put a
// Book it button under "Call my mum" — the app confidently offering to help
// with something it had completely misread.
{
  console.log('');
  const mine = applyEdits(trip(), toEdits([
    { op: 'add_task', task: { what: 'Call my mum', kind: 'other' } },
    { op: 'add_task', task: { what: 'Buy an eSIM', kind: 'admin' } },
    { op: 'add_task', task: { what: 'Apply for the e-visa', kind: 'visa', link: 'https://evisa.test' } },
  ], 1));
  const by = (w) => checklist(mine).todo.find((t) => t.what === w);

  ok('an errand gets no booking link', linkFor(by('Call my mum'), mine) === '',
     linkFor(by('Call my mum'), mine));
  ok('nor does an admin job we know nothing about', linkFor(by('Buy an eSIM'), mine) === '');
  ok('but a link the agent gave is kept', linkFor(by('Apply for the e-visa'), mine) === 'https://evisa.test');
  ok('and a real booking still gets its search',
     /aviasales|google\.com\/travel/.test(linkFor(by('Book the flights'), mine)),
     linkFor(by('Book the flights'), mine));
  ok('a stay still gets one too', !!linkFor(by('Book Hotel Artemide'), mine));

  ok('what the plan implies is not theirs', !isOwn(by('Book the flights')));
  ok('what they added is', isOwn(by('Call my mum')));
  ok('and so is a to-do that moved off a day',
     isOwn({ id: 'mv:renew-passport' }));
}

// --- a room search that lands in the right town ------------------------------
//
// raffy, 2026-09-02, on his Desaru trip: "its giving me pricing option in other
// places too . not desaru." We were putting the property name into hotellook's
// `destination`, which takes a PLACE — given a hotel name it cannot place, it
// fuzzy-matches to whatever it can, and a Desaru search comes back showing
// hotels somewhere else.
{
  console.log('');
  ok('a city search names the city',
     /destination=Desaru\+Coast/.test(hotelSearchLink({ city: 'Desaru Coast, Johor' })),
     hotelSearchLink({ city: 'Desaru Coast, Johor' }));
  ok('a hotel name alone builds no link at all',
     hotelSearchLink({ hotel: 'Mandarin Oriental Desaru Coast' }) === '',
     JSON.stringify(hotelSearchLink({ hotel: 'Mandarin Oriental Desaru Coast' })));

  const t = trip();
  t.trip.title = 'Desaru Coast';
  t.stays = [{ n: 'Mandarin Oriental, Desaru Coast', draft: true }];
  const room = linkFor(checklist(t).todo.find((x) => /Mandarin/.test(x.what)), t);
  ok('Find rooms searches the town, not the hotel name',
     /destination=Desaru\+Coast/.test(room) && !/Mandarin/.test(room), room);

  // Their own booking page is the actual hotel on the actual dates. An
  // aggregator search is a guess at which property you meant.
  const own = { ...t, stays: [{ n: 'Mandarin Oriental, Desaru Coast', draft: true,
    site: ['Their site', 'https://www.mandarinoriental.com/desaru-coast'] }] };
  ok('but their own booking page wins when there is one',
     linkFor(checklist(own).todo.find((x) => /Mandarin/.test(x.what)), own)
       === 'https://www.mandarinoriental.com/desaru-coast');
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
