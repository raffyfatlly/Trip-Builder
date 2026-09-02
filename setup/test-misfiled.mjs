// A to-do the agent filed onto a day.
//
// raffy, 2026-09-02, third report: "if the agent can pass it in my days
// section, he can put it in the to do page." His session log had this in it:
//
//   {"op":"add","day":0,"item":{"h":"Renew passport","t":"Before you fly",
//    "tags":["To-do","Reminder"], ...}}
//
// The agent knew. It tagged the thing "To-do" and wrote "Before you fly" in
// the time field — not a time, but the only field it had for saying "this does
// not happen on this day". Two rounds of prompt wording did not change it.
// This is the code that does, so it is tested from the exact shapes he hit.
//
//   node setup/test-misfiled.mjs

import { applyEdits, countStale, looksLikeTask } from '../lib/edits.js';
import { toEdits } from '../lib/editTools.js';
import { checklist } from '../lib/checklist.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const trip = () => ({
  trip: { start: '2026-09-25', end: '2026-09-30', title: 'Sorrento' },
  stays: [{ n: 'Hotel Mediterraneo', draft: true }],
  days: [{ dow: 'Fri', dom: '25', items: [{ _id: 'x', h: 'Land at Naples', t: '6:40am' }] }],
});

// The three he actually got, verbatim from his session.
const HIS = [
  { h: 'Renew passport', t: 'Before you fly', tags: ['To-do', 'Reminder'],
    p: 'Check passport validity and renew now if needed.' },
  { h: 'Set roaming on', t: 'Day of flight', tags: ['To-do', 'Reminder'],
    p: 'Turn on roaming or activate your travel eSIM before you leave KLIA.' },
  { h: 'Travel insurance', t: 'Before you fly', tags: ['To-do', 'Reminder'],
    p: 'Buy travel insurance covering the trip.' },
];

{
  console.log('');
  for (const x of HIS) ok('"' + x.h + '" is recognised as a to-do', looksLikeTask(x));

  // Real day items must be left alone — a fuzzy time is not a to-do.
  for (const x of [
    { h: 'Breakfast', t: 'Morning' },
    { h: 'Beach', t: 'All day' },
    { h: 'Dinner at Zi Teresa', t: '~8:00pm', tags: ['Book ahead'] },
    { h: 'Pompeii', t: '9:00am', tags: ['Tickets'] },
  ]) ok('"' + x.h + '" stays on its day', !looksLikeTask(x), x.t);
}

// --- the agent adds one: it never reaches a day -----------------------------
{
  console.log('');
  const edits = toEdits(HIS.map((item) => ({ op: 'add', day: 0, item })), 1);
  ok('every one becomes a task, not a day item',
     edits.length === 3 && edits.every((e) => e.type === 'task.set'),
     edits.map((e) => e.type).join(' '));

  const it = applyEdits(trip(), edits);
  ok('the day is untouched', it.days[0].items.length === 1, it.days[0].items.map((x) => x.h).join(' | '));
  const list = checklist(it).todo.map((t) => t.what);
  for (const x of HIS) ok('"' + x.h + '" is on the to-do list', list.some((w) => w === x.h), list.join(' | '));
  ok('and it reads as an errand, not a sight',
     checklist(it).todo.find((t) => t.what === 'Renew passport').kind === 'visa');
}

// --- one that is already on a day: it moves across --------------------------
//
// Three of these were in his trip before the fix. Telling him to add them
// again would be making him pay for our bug.
{
  console.log('');
  const stuck = trip();
  stuck.days[0].items.push(...HIS.map((x, i) => ({ ...x, _id: 'old' + i })));
  const it = applyEdits(stuck, []);
  ok('an already-filed to-do leaves the day', it.days[0].items.length === 1,
     it.days[0].items.map((x) => x.h).join(' | '));
  ok('and turns up on the list', checklist(it).todo.filter((t) => HIS.some((h) => h.h === t.what)).length === 3);
  ok('it is idempotent', applyEdits(applyEdits(stuck, []), []).days[0].items.length === 1);

  // Ticking one off has to survive the move, or the migration would quietly
  // un-do work every time the log replays.
  // Keyed by the heading, so the id survives anything being added above it.
  ok('the id is keyed by what it says, not where it sat',
     checklist(it).todo.some((t) => t.id === 'mv:renew-passport'),
     checklist(it).todo.map((t) => t.id).join(' '));
  const ticked = applyEdits(stuck, [
    { type: 'task.set', id: 'mv:renew-passport', task: { done: true }, ts: 2 },
  ]);
  ok('a to-do they already ticked off stays ticked',
     checklist(ticked).done.some((t) => t.what === 'Renew passport'),
     checklist(ticked).done.map((t) => t.what).join(' | '));
  ok('and is not still outstanding', !checklist(ticked).todo.some((t) => t.what === 'Renew passport'));

  // The id must not move when something is inserted above it, or ticking one
  // off would be undone by the next thing added to that day.
  const shifted = { ...stuck, days: [{ ...stuck.days[0],
    items: [{ _id: 'new', h: 'Coffee', t: '8:00am' }, ...stuck.days[0].items] }] };
  ok('and stays ticked after something is added above it',
     checklist(applyEdits(shifted, [
       { type: 'task.set', id: 'mv:renew-passport', task: { done: true }, ts: 2 },
     ])).done.some((t) => t.what === 'Renew passport'));
}

// --- the stale count must survive a task edit --------------------------------
//
// countStale held a copy of applyEdits' task handler, pasted into a function
// that has no `out`. It sat unreachable until to-dos started being routed as
// tasks, and then the first one threw ReferenceError on load and took the
// whole app down — a white screen on his phone.
//
// The rule it should have been written to: a task or a booking is never
// orphaned, because neither is addressed by a day id, and a day id is the only
// thing a rebuild invalidates.
{
  console.log('');
  const it = trip();
  const edits = [
    ...toEdits(HIS.map((item) => ({ op: 'add', day: 0, item })), 1),
    { type: 'task.set', id: 'tk1', task: { done: true }, ts: 2 },
    { type: 'booking.set', id: 'bk1', booking: { kind: 'stay', title: 'Hotel Mediterraneo' }, ts: 3 },
  ];
  let threw = null;
  try { countStale(it, edits); } catch (e) { threw = e.message; }
  ok('counting stale edits does not throw on a task', !threw, threw || '');
  ok('and a task edit is never counted stale', countStale(it, edits) === 0, String(countStale(it, edits)));

  // The real orphan it exists to find still gets found.
  ok('an edit pointing at a day that is gone still counts',
     countStale(it, [{ type: 'item.update', day: 9, id: 'x', patch: { t: '1pm' } }]) === 1);
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
