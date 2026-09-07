// Moving a trip to different dates without rebuilding it.
//
// raffy, 2026-09-07, on Syahirah's Singapore trip — the first person other than
// him to use this: "when she realise she got the dates wrong, the app rebuilds
// from scratch again without no telling her how much credit it will take her
// etc. so now she left with no credit."
//
// She got the dates wrong, said so, and the agent rebuilt the whole trip.
// That was not the agent misbehaving: "different dates" was listed in its own
// instructions as a legitimate reason to rebuild, because nothing here could
// change a date any other way. So it did the expensive thing, correctly, and
// it cost her everything she had.
//
// But a trip that moves by a week is not a different trip. The same days, the
// same hotels, the same places, in the same order — every date in it is the old
// date plus an offset. There is no research in that and no judgement; it is
// arithmetic, and arithmetic does not need a language model. This is the
// arithmetic.
//
// What this CANNOT do is change the LENGTH of a trip. Six nights becoming eight
// means two days nobody has planned, and that is a real rebuild. It refuses
// rather than inventing them.

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Parse an ISO date as UTC noon, so no timezone can push it onto another day. */
export function parseISO(s) {
  if (!ISO.test(String(s || '').trim())) return null;
  const [y, m, d] = String(s).trim().split('-').map(Number);
  const t = Date.UTC(y, m - 1, d, 12);
  const back = new Date(t);
  // Rejects 2026-02-31 and friends, which Date.UTC would silently roll over.
  return back.getUTCMonth() === m - 1 && back.getUTCDate() === d ? back : null;
}

export const toISO = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);

/** "15 to 17 Aug", or "15 Aug" for a single night. */
export function stayDates(from, to) {
  const a = MON[from.getUTCMonth()];
  const b = MON[to.getUTCMonth()];
  if (from.getTime() === to.getTime()) return from.getUTCDate() + ' ' + a;
  return a === b
    ? from.getUTCDate() + ' to ' + to.getUTCDate() + ' ' + a
    : from.getUTCDate() + ' ' + a + ' to ' + to.getUTCDate() + ' ' + b;
}

/**
 * The edit ops that move an itinerary to a new start date.
 *
 * Returns `{ ops, days, from, to }` on success, or `{ error }` with something
 * worth saying out loud. Pure — it reads the itinerary and returns operations,
 * so the same function serves the agent's tool and the manual editor, and a
 * test can check the arithmetic without a trip existing anywhere.
 */
export function shiftDates(it, newStart, seq = 0) {
  const trip = (it && it.trip) || null;
  const days = (it && it.days) || [];
  if (!trip || !days.length) return { error: 'there is no itinerary to move yet' };

  const from = parseISO(trip.start);
  const to = parseISO(newStart);
  if (!from) return { error: 'the trip has no usable start date on it, so it cannot be shifted' };
  if (!to) return { error: 'give the new start date as YYYY-MM-DD' };

  const offset = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  if (offset === 0) return { error: 'that is already the start date — nothing to change' };

  const ops = [];
  const at = (i) => seq + i;
  let n = 0;

  // The trip header. `end` moves with `start`, keeping the length exactly.
  const lastDay = addDays(to, days.length - 1);
  // `end` is the day they come home, which the builder writes as the last day
  // of the trip. Derive it from the original gap rather than assuming, because
  // some trips put `end` on the departure day and some on the day after.
  const oldEnd = parseISO(trip.end);
  const endGap = oldEnd ? Math.round((oldEnd.getTime() - from.getTime()) / DAY_MS) : days.length - 1;
  ops.push({
    type: 'trip.update',
    patch: { start: toISO(to), end: toISO(addDays(to, endGap)) },
    ts: at(n++), by: 'agent',
  });

  // Every day's weekday and day-of-month. These are what the app prints on the
  // timeline, so leaving them behind is how a "moved" trip still shows the old
  // Tuesday against the new date.
  days.forEach((d, i) => {
    const on = addDays(to, i);
    const dow = DOW[on.getUTCDay()];
    const dom = on.getUTCDate();
    if (d.dow === dow && d.dom === dom) return;
    ops.push({ type: 'day.update', day: i, patch: { dow, dom }, ts: at(n++), by: 'agent' });
  });

  // Each stay's display range. Worked out from which days point at that stay
  // rather than by parsing the old string — "15 to 17 Aug" is for reading, not
  // for arithmetic, and it is written differently across months.
  (it.stays || []).forEach((s, si) => {
    const mine = days.map((d, i) => (d.stay === si ? i : -1)).filter((i) => i >= 0);
    if (!mine.length) return;
    const dates = stayDates(addDays(to, mine[0]), addDays(to, mine[mine.length - 1]));
    if (dates === s.dates) return;
    ops.push({ type: 'stay.update', index: si, patch: { dates }, ts: at(n++), by: 'agent' });
  });

  return { ops, days: days.length, offset, from: toISO(from), to: toISO(to) };
}

/**
 * Would this date change be a shift, or does it change the trip's length?
 *
 * A shift is an edit; a different length is add_day / remove_day, also an edit.
 * Neither is free — every change costs the turn it takes — but both are a
 * fraction of re-planning the trip. Answering this is the whole point: it is the
 * question the agent was getting wrong, expensively.
 */
export function dateChangeKind(it, newStart, newEnd) {
  const days = ((it && it.days) || []).length;
  if (!days) return 'build';
  const a = parseISO(newStart);
  const b = newEnd ? parseISO(newEnd) : null;
  if (!a) return 'unknown';
  if (!b) return 'shift';
  const want = Math.round((b.getTime() - a.getTime()) / DAY_MS) + 1;
  return want === days ? 'shift' : 'rebuild';
}

/**
 * Put every date in the itinerary back in agreement with `trip.start`.
 *
 * raffy, 2026-09-07: "whatever kind of edits the user wants to do, can it just
 * not rebuild again? like that just fixing the things that are changed."
 *
 * Adding or removing a day used to be a rebuild, and the reason was never the
 * day itself — it was everything downstream of it. Insert a Wednesday and every
 * later day is on the wrong date, the trip ends a day earlier than it should,
 * and the hotel ranges are all short by one. That is the same arithmetic as a
 * shift, so it is done the same way: change the structure, then derive every
 * date from the start again.
 *
 * Mutates and returns `it`. Called automatically after any op that changes how
 * many days there are, so it is impossible to add a day and forget.
 */
export function redate(it) {
  const trip = (it && it.trip) || null;
  const days = (it && it.days) || [];
  const from = trip && parseISO(trip.start);
  if (!from || !days.length) return it;

  days.forEach((d, i) => {
    const on = addDays(from, i);
    d.dow = DOW[on.getUTCDay()];
    d.dom = on.getUTCDate();
  });
  trip.end = toISO(addDays(from, days.length - 1));

  (it.stays || []).forEach((s, si) => {
    const mine = days.map((d, i) => (d.stay === si ? i : -1)).filter((i) => i >= 0);
    if (!mine.length) return;
    s.dates = stayDates(addDays(from, mine[0]), addDays(from, mine[mine.length - 1]));
    const n = mine.length;
    // `nights` is a display string ("2 nights"). Only rewrite it when it is one
    // of those — a stay that says something else was written deliberately.
    if (/^\d+\s+nights?$/i.test(String(s.nights || ''))) {
      s.nights = n + (n === 1 ? ' night' : ' nights');
    }
  });
  return it;
}

/**
 * What kind of change is this build call really asking for?
 *
 * This is the decision that guards the traveller's balance, so it does not live
 * inside the request handler where nothing can test it. Three answers:
 *
 *   'date-shift'  — same place, same length, different days. shift_dates.
 *   'date-length' — same place, different number of days. shift_dates + add_day
 *                   / remove_day.
 *   'other'       — everything else, including a hotel change that leaves the
 *                   dates alone. Needs their yes before anything is spent.
 *
 * The `dateMoved` check matters more than it looks. Without it, a call that
 * changed the HOTEL and left the dates untouched came back told "this is just a
 * date change" — wrong, and about a part of the trip it had not touched.
 */
export function changeShape(it, input) {
  const was = (it && it.trip) || {};
  const start = input && input.start;
  const norm = (x) => String(x || '').trim().toLowerCase();
  const a = norm(input && input.destination);
  const b = norm(was.title);
  // Either string may be the longer one — "Singapore" against "Singapore,
  // Singapore" — so check both ways. When it cannot tell, it falls through to
  // 'other', which is the safe direction: it asks rather than assuming.
  const sameCity = !!a && !!b && (a.includes(b) || b.includes(a));
  if (!sameCity || !start || start === was.start) return 'other';
  return dateChangeKind(it, start, input && input.end) === 'shift' ? 'date-shift' : 'date-length';
}
