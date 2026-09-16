// A malformed save_itinerary call must never wedge a session for good.
//
// raffy, 2026-09-16: the Istanbul trip. One save_itinerary call sent `days`
// as something other than an array — `input.days || []` never catches that,
// because a stray object or string is truthy, not falsy. `state.days` then
// carried that shape forever: the itinerary is replayed from this same event
// on every single request, and every downstream `(it.days || []).forEach`
// (describeItinerary, checklist, applyEdits) threw the same TypeError,
// permanently — advance failed 500, over and over, no way back in.
//
//   node setup/test-malformedbuild.mjs

import { applyEdit } from '../lib/itinerary.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

for (const bad of [{}, 'seven days', 42, null]) {
  const state = applyEdit(null, 'save_itinerary', {
    trip: { title: 'Istanbul' },
    days: bad,
    stays: bad,
    ideas: bad,
    areas: bad,
  });
  ok('days becomes [] rather than ' + JSON.stringify(bad), Array.isArray(state.days) && state.days.length === 0);
  ok('stays becomes [] too', Array.isArray(state.stays) && state.stays.length === 0);
  let threw = false;
  try { (state.days || []).forEach(() => {}); } catch (e) { threw = true; }
  ok('a downstream .forEach over days does not throw', !threw);
}

// A well-formed save still works exactly as before.
const good = applyEdit(null, 'save_itinerary', {
  trip: { title: 'Istanbul' },
  days: [{ dow: 'Mon', items: [{ h: 'Hagia Sophia' }] }],
  stays: [{ n: 'A hotel' }],
});
ok('a normal save is untouched', good.days.length === 1 && good.stays.length === 1);

console.log(fail ? '\n' + fail + ' failed' : '\nall passed');
process.exit(fail ? 1 : 0);
