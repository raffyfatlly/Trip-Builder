// Changing the dates must not rebuild the trip.
//
// raffy, 2026-09-07, on Syahirah's Singapore trip — the first person other than
// him to use this: "when she realise she got the dates wrong, the app rebuilds
// from scratch again without no telling her how much credit it will take her
// etc. so now she left with no credit."
//
// Two things had to be true for that to happen and both are covered here: a
// date change had no cheap path, and nothing but a prompt stood between the
// agent and spending her balance.
import assert from 'node:assert';
import { shiftDates, dateChangeKind, stayDates, parseISO, toISO } from '../lib/dates.js';
import { applyEdits } from '../lib/edits.js';
import { toEdits } from '../lib/editTools.js';

let n = 0;
const t = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };

// Six days over a weekend, two hotels, a flight pinned to day 0.
const TRIP = () => ({
  trip: { title: 'Singapore', start: '2026-11-12', end: '2026-11-17' },
  stays: [
    { n: 'Hotel A', dates: '12 to 14 Nov', nights: '2 nights' },
    { n: 'Hotel B', dates: '15 to 17 Nov', nights: '3 nights' },
  ],
  days: [
    { dow: 'THU', dom: 12, stay: 0, title: 'Arrive', items: [{ t: '09:00', h: 'Flight SQ123' }] },
    { dow: 'FRI', dom: 13, stay: 0, title: 'Gardens', items: [] },
    { dow: 'SAT', dom: 14, stay: 0, title: 'Sentosa', items: [] },
    { dow: 'SUN', dom: 15, stay: 1, title: 'Move hotels', items: [] },
    { dow: 'MON', dom: 16, stay: 1, title: 'Museums', items: [] },
    { dow: 'TUE', dom: 17, stay: 1, title: 'Home', items: [] },
  ],
});

console.log('\nMoving the whole trip');
{
  const it = TRIP();
  const moved = applyEdits(it, shiftDates(it, '2026-11-19').ops);

  t('the header moves and keeps its length', () => {
    assert.equal(moved.trip.start, '2026-11-19');
    assert.equal(moved.trip.end, '2026-11-24');
  });
  t('every day gets the right weekday, not just a new number', () => {
    assert.deepEqual(moved.days.map((d) => d.dow + d.dom),
      ['THU19', 'FRI20', 'SAT21', 'SUN22', 'MON23', 'TUE24']);
  });
  t('each stay covers the days that actually point at it', () => {
    assert.equal(moved.stays[0].dates, '19 to 21 Nov');
    assert.equal(moved.stays[1].dates, '22 to 24 Nov');
  });
  t('nothing else is touched — the plan is the same plan', () => {
    assert.equal(moved.days.length, 6);
    assert.equal(moved.days[0].title, 'Arrive');
    assert.equal(moved.days[0].items[0].h, 'Flight SQ123');
    assert.equal(moved.stays[0].n, 'Hotel A');
    assert.equal(moved.stays[0].nights, '2 nights');
  });
}

console.log('\nThe arithmetic that a rebuild used to be asked for');
{
  t('a shift across a month boundary', () => {
    const it = TRIP();
    const moved = applyEdits(it, shiftDates(it, '2026-11-28').ops);
    assert.deepEqual(moved.days.map((d) => d.dow + d.dom),
      ['SAT28', 'SUN29', 'MON30', 'TUE1', 'WED2', 'THU3']);
    assert.equal(moved.stays[1].dates, '1 to 3 Dec');
  });
  t('a shift across a year boundary', () => {
    const it = TRIP();
    const moved = applyEdits(it, shiftDates(it, '2026-12-30').ops);
    assert.equal(moved.trip.start, '2026-12-30');
    assert.equal(moved.trip.end, '2027-01-04');
    assert.equal(moved.days[3].dom, 2);
  });
  t('a leap day is a real day', () => {
    assert.ok(parseISO('2028-02-29'));
    assert.equal(parseISO('2027-02-29'), null);
  });
  t('an impossible date is refused rather than rolled over', () => {
    assert.equal(parseISO('2026-11-31'), null);
    assert.equal(shiftDates(TRIP(), '2026-11-31').error, 'give the new start date as YYYY-MM-DD');
  });
  t('a one-night stay reads as one date, not a range', () => {
    const d = parseISO('2026-11-19');
    assert.equal(stayDates(d, d), '19 Nov');
  });
  t('moving to the same day is refused, not applied as a no-op', () => {
    assert.ok(shiftDates(TRIP(), '2026-11-12').error);
  });
  // Timezones are how date arithmetic usually goes wrong: parse at midnight in
  // a negative offset and every date lands a day early.
  t('no timezone can push a date onto the day before', () => {
    assert.equal(toISO(parseISO('2026-01-01')), '2026-01-01');
    assert.equal(toISO(parseISO('2026-12-31')), '2026-12-31');
  });
}

console.log('\nShift or rebuild — the question that cost her the credits');
{
  t('same length, different start: a shift', () => {
    assert.equal(dateChangeKind(TRIP(), '2026-11-19', '2026-11-24'), 'shift');
  });
  t('longer trip: a real rebuild, because those days have nothing in them', () => {
    assert.equal(dateChangeKind(TRIP(), '2026-11-19', '2026-11-26'), 'rebuild');
  });
  t('shorter trip: also a rebuild', () => {
    assert.equal(dateChangeKind(TRIP(), '2026-11-19', '2026-11-21'), 'rebuild');
  });
  t('no end date given: treated as a shift, which is the cheap guess', () => {
    assert.equal(dateChangeKind(TRIP(), '2026-11-19'), 'shift');
  });
  t('nothing built yet: build, not shift', () => {
    assert.equal(dateChangeKind({ days: [] }, '2026-11-19'), 'build');
  });
}

console.log('\nThrough the agent tool, the way it actually arrives');
{
  t('shift_dates reaches the itinerary', () => {
    const it = TRIP();
    const out = applyEdits(it, toEdits([{ op: 'shift_dates', newStart: '2026-11-19' }], 1, it));
    assert.equal(out.trip.start, '2026-11-19');
    assert.equal(out.days[0].dow, 'THU');
  });
  t('two shifts compound rather than both measuring from the original', () => {
    const it = TRIP();
    const first = toEdits([{ op: 'shift_dates', newStart: '2026-11-19' }], 1, it);
    // The second is computed against the trip AS IT NOW STANDS, which is what
    // the replay in agentEditsIn has to reproduce.
    const mid = applyEdits(it, first);
    const second = toEdits([{ op: 'shift_dates', newStart: '2026-11-26' }], 20, mid);
    const out = applyEdits(it, [...first, ...second]);
    assert.equal(out.trip.start, '2026-11-26');
    assert.deepEqual(out.days.map((d) => d.dom), [26, 27, 28, 29, 30, 1]);
  });
  t('a bad date produces no ops at all rather than a half-moved trip', () => {
    const it = TRIP();
    assert.deepEqual(toEdits([{ op: 'shift_dates', newStart: 'next tuesday' }], 1, it), []);
    assert.deepEqual(toEdits([{ op: 'shift_dates', newStart: '2026-11-19' }], 1, null), []);
  });
}

console.log('\nA longer or shorter trip is an edit too');
{
  // raffy, 2026-09-07: "whatever kind of edits the user wants to do, can it
  // just not rebuild again?" Adding a day was a rebuild — not because the day
  // is hard, but because every date after it moves. That is arithmetic.
  t('a day inserted in the middle pushes everything after it', () => {
    const it = TRIP();
    const out = applyEdits(it, toEdits([{
      op: 'add_day', at: 2, newDay: { title: 'Extra', sub: 'A spare day', stay: 0 },
    }], 1, it));
    assert.equal(out.days.length, 7);
    assert.equal(out.days[2].title, 'Extra');
    assert.deepEqual(out.days.map((d) => d.dow + d.dom),
      ['THU12', 'FRI13', 'SAT14', 'SUN15', 'MON16', 'TUE17', 'WED18']);
    assert.equal(out.trip.end, '2026-11-18', 'the trip has to end a day later');
  });
  t('the stay it lands in covers the extra night', () => {
    const it = TRIP();
    const out = applyEdits(it, toEdits([{
      op: 'add_day', at: 2, newDay: { title: 'Extra', stay: 0 },
    }], 1, it));
    assert.equal(out.stays[0].dates, '12 to 15 Nov');
    assert.equal(out.stays[0].nights, '4 nights');
    assert.equal(out.stays[1].dates, '16 to 18 Nov');
  });
  t('a day appended at the end', () => {
    const it = TRIP();
    const out = applyEdits(it, toEdits([{
      op: 'add_day', at: 6, newDay: { title: 'One more', stay: 1 },
    }], 1, it));
    assert.equal(out.days.length, 7);
    assert.equal(out.days[6].title, 'One more');
    assert.equal(out.days[6].dom, 18);
  });
  t('items on a new day get ids, or nothing can edit them later', () => {
    const it = TRIP();
    const out = applyEdits(it, toEdits([{
      op: 'add_day', at: 1, newDay: { title: 'Extra', stay: 0, items: [{ t: '10:00', h: 'Zoo' }] },
    }], 1, it));
    assert.ok(out.days[1].items[0]._id, 'no id means a later edit silently misses');
  });
  t('a day removed pulls everything back', () => {
    const it = TRIP();
    const out = applyEdits(it, toEdits([{ op: 'remove_day', at: 1 }], 1, it));
    assert.equal(out.days.length, 5);
    assert.equal(out.days[1].title, 'Sentosa');
    assert.deepEqual(out.days.map((d) => d.dom), [12, 13, 14, 15, 16]);
    assert.equal(out.trip.end, '2026-11-16');
  });
  t('the last day standing cannot be removed', () => {
    const one = { trip: { start: '2026-11-12', end: '2026-11-12' }, stays: [],
      days: [{ dow: 'THU', dom: 12, stay: 0, title: 'Only', items: [] }] };
    assert.equal(applyEdits(one, toEdits([{ op: 'remove_day', at: 0 }], 1, one)).days.length, 1);
  });
  t('an out-of-range day is ignored rather than corrupting the trip', () => {
    const it = TRIP();
    assert.equal(applyEdits(it, toEdits([{ op: 'remove_day', at: 99 }], 1, it)).days.length, 6);
  });
  t('adding a day does not disturb what is already on the other days', () => {
    const it = TRIP();
    const out = applyEdits(it, toEdits([{
      op: 'add_day', at: 0, newDay: { title: 'New first', stay: 0 },
    }], 1, it));
    assert.equal(out.days[1].title, 'Arrive');
    assert.equal(out.days[1].items[0].h, 'Flight SQ123');
  });
}

console.log('\nThe trip header');
{
  t('update_trip renames without touching anything else', () => {
    const it = TRIP();
    const out = applyEdits(it, toEdits([{
      op: 'update_trip', tripPatch: { title: 'Singapore & Johor', titleSub: 'six nights' },
    }], 1, it));
    assert.equal(out.trip.title, 'Singapore & Johor');
    assert.equal(out.trip.start, '2026-11-12', 'the dates are not its business');
  });
  t('it cannot move the dates behind the days backs', () => {
    const it = TRIP();
    const out = applyEdits(it, toEdits([{
      op: 'update_trip', tripPatch: { start: '2027-01-01', end: '2027-01-06' },
    }], 1, it));
    assert.equal(out.trip.start, '2026-11-12');
    assert.equal(out.trip.end, '2026-11-17');
  });
}

console.log('\n' + n + ' passed');
