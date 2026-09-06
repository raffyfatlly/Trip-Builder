// Swapping a hotel must be an EDIT, not a rebuild.
//
// raffy, 2026-09-06: "lets say a user change one hotel location . would this
// trigger a new rebuild ... can't it just edit the part where it need to edit".
//
// It could not: applyEdits has handled stay.update since bookings were added,
// but the agent's edit_itinerary had no operation that produced one — only
// "mark this stay booked". So the single most common change after a trip is
// built had no path except a full rebuild: minutes of waiting, roughly fifty
// times the cost, and not undoable.

import assert from 'node:assert';
import { toEdits } from '../lib/editTools.js';
import { applyEdits } from '../lib/edits.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

const TRIP = () => ({
  trip: { title: 'Chiang Mai' },
  stays: [{ n: 'Tamarind Village', short: 'Tamarind', loc: 'Old City', dates: '12-16 Nov',
    nights: 4, ci: '14:00', co: '12:00', lat: 18.7883, lon: 98.9853, draft: true }],
  days: [{ dow: 'Thu', dom: '12', stay: 0, title: 'Arrive', sub: 'Old City',
    items: [{ t: '8:00am', h: 'Breakfast at Tamarind Village', p: 'In the courtyard.' }] }],
  photos: {},
});

const swap = (patch) => toEdits([{ op: 'update_stay', stay: 0, stayPatch: patch }], 1);

console.log('\nSwapping a hotel');

t('the tool now produces a stay.update, which the engine already understood', () => {
  const ops = swap({ n: 'Ping Nakara' });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, 'stay.update');
  assert.equal(ops[0].index, 0);
  assert.deepEqual(ops[0].patch, { n: 'Ping Nakara' });
});

t('the new hotel lands on the trip', () => {
  const out = applyEdits(TRIP(), swap({
    n: 'Ping Nakara Boutique Hotel', short: 'Ping Nakara', loc: 'Wat Ket',
    lat: 18.7845, lon: 98.9975,
  }));
  assert.equal(out.stays[0].n, 'Ping Nakara Boutique Hotel');
  assert.equal(out.stays[0].short, 'Ping Nakara');
  assert.equal(out.stays[0].loc, 'Wat Ket');
});

t('and the map moves with it', () => {
  // Without new coordinates the pin, the route and the gutter bubble all stay
  // on the old building — which looks like a bug rather than a stale field.
  const out = applyEdits(TRIP(), swap({ n: 'Ping Nakara', lat: 18.7845, lon: 98.9975 }));
  assert.equal(out.stays[0].lat, 18.7845);
  assert.equal(out.stays[0].lon, 98.9975);
});

t('only the fields sent are touched', () => {
  const out = applyEdits(TRIP(), swap({ n: 'Ping Nakara' }));
  assert.equal(out.stays[0].nights, 4);
  assert.equal(out.stays[0].ci, '14:00');
  assert.equal(out.stays[0].dates, '12-16 Nov');
  assert.equal(out.stays[0].draft, true);
});

t('the days are left exactly alone — that is the point', () => {
  const before = TRIP();
  const out = applyEdits(before, swap({ n: 'Ping Nakara' }));
  assert.equal(out.days.length, 1);
  assert.equal(out.days[0].items.length, 1);
  assert.equal(out.days[0].title, 'Arrive');
});

t('an item that named the old hotel is fixed the ordinary way', () => {
  // update_stay does not rewrite prose, deliberately: guessing which sentences
  // mean the hotel is how you end up renaming somebody else's restaurant.
  const out = applyEdits(TRIP(), toEdits([
    { op: 'update_stay', stay: 0, stayPatch: { n: 'Ping Nakara', lat: 18.7845, lon: 98.9975 } },
    { op: 'update', day: 0, id: 'b0-0', patch: { h: 'Breakfast at Ping Nakara' } },
  ], 1));
  assert.equal(out.stays[0].n, 'Ping Nakara');
  assert.equal(out.days[0].items[0].h, 'Breakfast at Ping Nakara');
});

console.log('\nWhat it refuses to do');

t('no index, no change', () => {
  assert.deepEqual(toEdits([{ op: 'update_stay', stayPatch: { n: 'X' } }], 1), []);
});
t('no patch, no change', () => {
  assert.deepEqual(toEdits([{ op: 'update_stay', stay: 0 }], 1), []);
  assert.deepEqual(toEdits([{ op: 'update_stay', stay: 0, stayPatch: {} }], 1), []);
});
t('a stay that does not exist is ignored rather than invented', () => {
  const out = applyEdits(TRIP(), swap({ n: 'X' }).map((o) => ({ ...o, index: 7 })));
  assert.equal(out.stays.length, 1);
  assert.equal(out.stays[0].n, 'Tamarind Village');
});

console.log('\nStill true: confirming a stay');
t('confirm_stay is untouched by any of this', () => {
  const out = applyEdits(TRIP(), toEdits([{ op: 'confirm_stay', stay: 0 }], 1));
  assert.equal(out.stays[0].draft, false);
  assert.equal(out.stays[0].n, 'Tamarind Village');
});

console.log('\n' + n + ' passed\n');
