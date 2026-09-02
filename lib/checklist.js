// The arranging phase, which the app did not have.
//
// raffy, 2026-09-01: "i want to add like a to do list . this includes things
// like purchase flight ticket etc etc or book hotel or whatever places they
// wanna go like Disneyland or something."
//
// He asked for this having shipped the Wallet's "Still to sort" section three
// hours earlier and not recognised it. That was the diagnosis, not a lapse: a
// trip runs DECIDING -> ARRANGING -> GOING, the app was strong at the first and
// the last, and arranging — the weeks where you actually buy the flight and
// book the room — had almost no product. It is the longest phase, the most
// anxious, the only one where somebody opens the app unprompted, and the only
// one where money moves.
//
// So the checklist and the wallet are ONE object in TWO states: to do, and
// done. Presenting them as two things is exactly why he reinvented one of them.
//
// Two rules shape everything here.
//
// **The list is derived, not written.** Every agreed plan already implies its
// own tasks — flights for these dates, a room for these nights, a ticket for
// anything timed. Asking the traveller to type that back in would be asking
// them to do the app's job. The agent adds only what a plan cannot imply: a
// visa, an eSIM, a restaurant that needs booking a month out.
//
// **It is ordered by deadline, not by type.** Disneyland sells out, a visa
// takes fifteen working days, flights get dearer. A list grouped by kind hides
// precisely the information that makes the list worth having.

import { flightSearchLink, hotelSearchLink } from './prices.js';

const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const parse = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? Date.parse(d + 'T00:00:00Z') : NaN);

// "2026-09-10" is how a database says a date. On a card somebody reads at a
// bus stop it should say Thu 10 Sep.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const human = (d) => {
  const t = parse(d);
  if (!Number.isFinite(t)) return String(d || '');
  const x = new Date(t);
  return DOW[x.getUTCDay()] + ' ' + x.getUTCDate() + ' ' + MON[x.getUTCMonth()];
};

// How long before the trip each kind of thing wants doing. Not arbitrary:
// these are the real lead times that catch people out.
const LEAD = {
  visa: 45,       // most consulates quote 15 working days and mean it
  flight: 60,     // the price curve turns against you inside two months
  travel: 55,     // a train or a ferry: fewer seats than a plane, gone sooner
  stay: 30,
  ticket: 21,     // timed-entry attractions sell out at about three weeks
  transfer: 7,
  admin: 14,      // insurance, eSIM, an international driving permit
  other: 14,
};

// A booking covers a task when the traveller said so (`task`), or when it is
// unambiguous: the stay it names, or the one flight everybody means.
//
// The traveller does not file a booking against a task id — they send a
// confirmation email and the agent writes down what it says. So the match has
// to be forgiving: an id if there is one, otherwise the name of the thing.
// "Book Furama Resort Danang" and a booking titled "Furama Resort Danang" are
// the same hotel, and showing them as two rows is exactly the duplication this
// whole file exists to end.
const VERB = /^(book|confirm|sort|apply for|arrange|get|buy|renew)\s+/i;
const norm = (s) => String(s || '').toLowerCase().replace(VERB, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

// Two names are the same thing when one contains the other — "Furama" against
// "Furama Resort Danang" — but only once there is enough of a name to be sure.
function sameThing(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y || x.length < 4 || y.length < 4) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function coversOf(bookings) {
  const byTask = new Set();
  const byStay = new Set();
  let anyFlight = false;
  for (const b of bookings || []) {
    if (b.task) byTask.add(b.task);
    if (Number.isInteger(b.stay)) byStay.add(b.stay);
    if (b.kind === 'flight') anyFlight = true;
  }
  return { byTask, byStay, anyFlight };
}

// The tasks a plan implies all by itself.
function derived(it) {
  const trip = it.trip || {};
  const start = parse(trip.start);
  const out = [];

  // Getting there is only a task if getting there is a thing they arrange.
  //
  // raffy, 2026-09-01: "if the trip doesn't involve flight , do not put confirm
  // the flights." A trip somebody drives to does not want a flight row, and a
  // list with one wrong item on it is a list people stop trusting.
  const flights = trip.flights || [];
  const how = trip.arriveBy || (flights.length ? 'fly' : 'fly');
  const GETTING = {
    train: { what: 'Book the train', why: 'Seats on the good departures go early.' },
    ferry: { what: 'Book the ferry', why: 'Crossings are limited and they fill in season.' },
    other: { what: 'Sort how you are getting there', why: '' },
  };
  if (how === 'fly') {
    const f0 = flights[0] || {};
    out.push({
      id: 'd:flights',
      kind: 'flight',
      what: flights.length ? 'Confirm the flights' : 'Book the flights',
      when: [f0.from && f0.to ? f0.from + ' \u2192 ' + f0.to : '', human(f0.date || trip.start), f0.dep]
        .filter(Boolean).join(' · '),
      why: flights.length
        ? 'You told me the times — file the confirmation so it is in your pocket.'
        : 'Nothing booked yet. Prices climb from about two months out.',
      route: flights.length
        ? { from: flights[0].from, to: flights[0].to, date: trip.start, back: trip.end }
        : { to: trip.title || '', date: trip.start, back: trip.end },
    });
  } else if (GETTING[how]) {
    out.push({ id: 'd:travel', kind: 'travel', ...GETTING[how], where: trip.title || '' });
  }
  // 'drive' adds nothing: their own car is not a booking.

  (it.stays || []).forEach((s, i) => {
    out.push({
      id: 'd:stay' + i,
      kind: 'stay',
      stay: i,
      what: 'Book ' + (s.n || 'somewhere to stay'),
      // Everything the app already knows about this stay, so the card is the
      // whole thing rather than a name and a button. raffy, 2026-09-01: "the
      // to do cards need to be more complete , based on context."
      when: [s.dates, s.nights].filter(Boolean).join(' · '),
      addr: s.loc || '',
      note: s.ci ? 'Check in ' + s.ci + (s.co ? ', out ' + s.co : '') : '',
      why: 'Where you sleep.',
      where: s.n,
      site: Array.isArray(s.site) ? s.site[1] : '',
    });
  });

  // Anything in the days the builder marked as needing booking ahead. The tag
  // is how the itinerary already says "this one is not walk-up".
  //
  // Deliberately narrow. A looser pattern that included "advance" matched
  // "Confirm in advance" on Friday prayers and put "Book Jumu'ah" on the list,
  // which is both useless and slightly insulting. A task nobody can act on
  // costs more than a task that is missing.
  const wants = /\b(book|booking|tickets?|reserve|reservation)\b/i;
  (it.days || []).forEach((d, di) => {
    (d.items || []).forEach((x) => {
      if (!(x.tags || []).some((t) => wants.test(t))) return;
      out.push({
        id: 'd:' + di + ':' + (x._id || x.h),
        kind: 'ticket',
        what: 'Book ' + x.h,
        when: [d.dow, d.dom, x.t].filter(Boolean).join(' '),
        why: (x.tags || []).find((t) => wants.test(t)) || '',
        where: x.h,
        on: d.date || null,
      });
    });
  });

  // Deadlines.
  //
  // The obvious version — departure minus the lead time, floored at today —
  // collapses every task onto today the moment a trip is closer than the
  // longest lead, which is most trips people actually plan. Six rows all
  // shouting DO THIS NOW carry no information: when everything is urgent,
  // nothing is, and the order is the only thing left saying anything.
  //
  // So when there is not enough runway, the lead times are COMPRESSED into
  // what runway there is. The order they imply is preserved — flights before
  // rooms before tickets — and each task still gets a date of its own to be
  // read by.
  const now = Date.now();
  const runway = Number.isFinite(start) ? start - now : NaN;
  const longest = Math.max(...out.map((t) => LEAD[t.kind] || LEAD.other));
  const tight = Number.isFinite(runway) && runway < longest * DAY;

  return out.map((t) => {
    const lead = LEAD[t.kind] || LEAD.other;
    if (!Number.isFinite(start)) return { ...t, by: null };
    if (!tight) return { ...t, by: iso(start - lead * DAY) };
    // Half the remaining window, shared out in lead order.
    const share = longest ? (1 - lead / longest) : 0;
    return { ...t, by: iso(now + Math.round(runway * 0.5 * share)) };
  });
}

// The whole list, in the order it has to happen.
//
// `tasks` are the agent's own additions (visa, eSIM, a restaurant that books
// out) and any the traveller ticked off by hand; `bookings` are the filed
// confirmations that mark one done.
export function checklist(it) {
  if (!it) return { todo: [], done: [], all: [] };
  const bookings = it.bookings || [];
  const added = it.tasks || [];
  const { byTask, byStay, anyFlight } = coversOf(bookings);

  // An entry sharing a derived task's id MERGES onto it rather than replacing
  // it. Ticking one off sends `{done:true}` and nothing else, so replacing
  // would leave a task with no name — the stay disappeared from the list
  // entirely instead of moving to done.
  const patch = new Map(added.map((t) => [t.id, t]));
  const seen = new Set();
  const all = [];
  for (const t of derived(it)) {
    seen.add(t.id);
    all.push(patch.has(t.id) ? { ...t, ...patch.get(t.id) } : t);
  }
  for (const t of added) if (!seen.has(t.id)) all.push(t);

  // A task can be taken off the list outright, derived ones included. That is
  // how "I am driving, there are no flights" gets fixed on a trip that is
  // already built, and how somebody deletes a to-do they added themselves.
  const live = all.filter((t) => !t.hidden);

  const isDone = (t) => {
    if (t.done) return true;
    if (byTask.has(t.id) || byTask.has(t.what)) return true;
    // A confirmation that names the thing closes the row for it, whatever kind
    // it is: a ticket, a transfer, a table. Without this, only stays and
    // flights could ever be ticked off by filing one.
    if ((bookings || []).some((b) => sameThing(b.title, t.where || t.what))) return true;
    if (t.kind === 'stay' && Number.isInteger(t.stay)) {
      if (byStay.has(t.stay)) return true;
      // The rest of the app already knows this one is booked.
      //
      // raffy, 2026-09-01: "in other pages for example the hotels already noted
      // as booked or confirmed , but im the to do page itself , the list
      // doesn't move from still to do to confirmed?"
      //
      // The list was only reading filed bookings, so confirming a stay any
      // other way — the agent's confirm_stay, a booking that named no index —
      // left the row sitting there contradicting the page next to it. A stay
      // that is no longer a draft is booked, whichever route got it there.
      const st = (it.stays || [])[t.stay];
      if (st && !st.draft) return true;
    }
    if (t.kind === 'flight' && anyFlight) return true;
    return false;
  };

  // The record that closed it travels WITH the task, so one card can show the
  // whole life of a thing: what to book, then what was booked, with its
  // reference. Two lists describing the same hotel is how this went wrong the
  // first time.
  const bookingFor = (t) => (bookings || []).find((b) =>
    b.task === t.id
    || b.task === t.what
    || (t.kind === 'stay' && Number.isInteger(t.stay) && b.stay === t.stay)
    || (t.kind === 'flight' && b.kind === 'flight')
    || sameThing(b.title, t.where || t.what)) || null;

  const withState = live.map((t) => {
    const done = isDone(t);
    return { ...t, done, booking: done ? bookingFor(t) : null };
  });

  // Deadline first. Anything without one sorts last rather than first — an
  // undated task is not urgent, it is unknown.
  const order = (a, b) => {
    const x = parse(a.by), y = parse(b.by);
    if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
    if (Number.isFinite(x)) return -1;
    if (Number.isFinite(y)) return 1;
    return 0;
  };

  const claimed = new Set(withState.map((t) => t.booking && t.booking.id).filter(Boolean));
  return {
    todo: withState.filter((t) => !t.done).sort(order),
    done: withState.filter((t) => t.done),
    all: withState,
    // Anything they filed that no task was waiting for — a transfer, a
    // restaurant, a ticket they booked off their own bat.
    extra: (bookings || []).filter((b) => !claimed.has(b.id)),
  };
}

// The link that actually completes a task. A checklist item without one is a
// reminder; with one it is a thing you can finish standing at a bus stop.
// Which kinds have a link worth offering. raffy, 2026-09-02: "for their own to
// do they don't need that book link . cause it can be as random as call my mum
// or whatever right".
//
// The fallback used to be a Google search for "<whatever> booking", which put
// a Book it button under "Call my mum" — an app confidently offering to help
// with something it has completely misread. A link is offered when we actually
// know one helps, and otherwise not at all. Silence beats a wrong guess on a
// list somebody is trusting.
const BOOKABLE = new Set(['flight', 'stay', 'ticket', 'transfer', 'travel']);

export function linkFor(task, it) {
  // One the agent supplied — a visa portal, an insurer — is always real.
  if (task.link) return task.link;
  if (!BOOKABLE.has(task.kind)) return '';
  const trip = (it && it.trip) || {};
  if (task.kind === 'flight') {
    const f = (trip.flights || [])[0] || {};
    const l = flightSearchLink({
      from: task.route && task.route.from ? task.route.from : f.from,
      to: task.route && task.route.to ? task.route.to : f.to,
      date: trip.start, back: trip.end,
      adults: Math.max(1, ((trip.travellers || []).length || 1)),
    });
    if (l) return l;
  }
  if (task.kind === 'stay') {
    const s = (it && it.stays && it.stays[task.stay]) || {};
    const l = hotelSearchLink({
      where: s.n || s.short || trip.title,
      checkIn: s.in || trip.start, checkOut: s.out || trip.end,
    });
    if (l) return l;
  }
  // A flight task with no airport codes is the common case for somebody who
  // has booked nothing — which is the traveller who needs this row most. A
  // plain web search is a poor answer to it, so fall through to Google
  // Flights, which parses a dated natural-language query and lands them on
  // real fares. It earns nothing, and it beats a dead end.
  if (task.kind === 'flight') {
    const to = (task.route && task.route.to) || trip.title || '';
    const on = trip.start ? ' on ' + trip.start : '';
    if (to) return 'https://www.google.com/travel/flights?q=' + encodeURIComponent('Flights to ' + to + on);
  }
  const q = task.where || task.what;
  return q ? 'https://www.google.com/search?q=' + encodeURIComponent(q + ' booking') : '';
}

// Did the plan imply this, or did they put it there?
//
// Derived rows are the bookings the trip cannot happen without — flights, each
// stay, anything the days tag as needing booking ahead — and they all carry a
// `d:` id. Everything else is theirs: what they added, and what the agent knew
// to add beyond the plan. Two different kinds of list, and reading them as one
// is what made his own to-dos look like unbooked hotels.
export const isOwn = (t) => !String(t.id || '').startsWith('d:');

// "In 3 weeks", "this week", "overdue" — said the way a person would.
export function dueIn(by, now = Date.now()) {
  const t = parse(by);
  if (!Number.isFinite(t)) return '';
  const d = Math.round((t - now) / DAY);
  if (d < 0) return 'do this now';
  if (d === 0) return 'today';
  if (d <= 7) return 'this week';
  if (d <= 14) return 'in 2 weeks';
  if (d <= 31) return 'in ' + Math.round(d / 7) + ' weeks';
  return 'by ' + new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
