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
    out.push({
      id: 'd:flights',
      kind: 'flight',
      what: flights.length ? 'Confirm the flights' : 'Book the flights',
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
      why: [s.dates, s.nights].filter(Boolean).join(', ') || 'Where you sleep.',
      where: s.n,
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
        why: [d.dow + ' ' + d.dom, (x.tags || []).find((t) => wants.test(t))].filter(Boolean).join(' · '),
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
    if (byTask.has(t.id)) return true;
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

  const withState = live.map((t) => ({ ...t, done: isDone(t) }));

  // Deadline first. Anything without one sorts last rather than first — an
  // undated task is not urgent, it is unknown.
  const order = (a, b) => {
    const x = parse(a.by), y = parse(b.by);
    if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
    if (Number.isFinite(x)) return -1;
    if (Number.isFinite(y)) return 1;
    return 0;
  };

  return {
    todo: withState.filter((t) => !t.done).sort(order),
    done: withState.filter((t) => t.done),
    all: withState,
  };
}

// The link that actually completes a task. A checklist item without one is a
// reminder; with one it is a thing you can finish standing at a bus stop.
export function linkFor(task, it) {
  if (task.link) return task.link;
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
