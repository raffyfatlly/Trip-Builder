// Fares must never be labelled with a date they are not for.
//
// raffy, 2026-09-06: "the flights fares never return the date then i want".
// Travelpayouts treats departure_at as the start of a WINDOW and answers with
// whatever is cheapest around it, so asking for the 12th gets rows for the
// 14th and the 27th. The old code printed all of them under a heading naming
// the 12th.
//
// Fixtures, no network — the shapes are copied from a real v3 response.

import assert from 'node:assert';
import { fareReport, hotelReport, hotelSearchLink } from '../lib/prices.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

const Q = { from: 'KUL', to: 'CNX', date: '2026-11-12', back: '2026-11-16' };
const row = (dep, ret, price, airline) => ({
  price, airline, flight_number: '123', transfers: 0,
  departure_at: dep + 'T09:15:00+08:00',
  return_at: ret ? ret + 'T18:40:00+07:00' : undefined,
});

console.log('\nFares');

t('a fare on the asked date is quoted plainly', () => {
  const out = fareReport([row('2026-11-12', '2026-11-16', 890, 'AK')], Q, 'L');
  assert.ok(out.includes('RM890'));
  assert.ok(!out.includes('NOTHING'));
  assert.ok(!out.includes('OTHER dates'));
});

t('nothing on the date is said outright, not papered over', () => {
  const out = fareReport([row('2026-11-27', '2026-12-01', 610, 'AK')], Q, 'L');
  assert.ok(out.includes('NOTHING on 2026-11-12'), out);
  assert.ok(out.includes('Do not quote any fare below as if it were their date'));
});

t('off-date fares carry their own date, loudly', () => {
  const out = fareReport([row('2026-11-27', '2026-12-01', 610, 'AK')], Q, 'L');
  assert.ok(out.includes('DEPARTS 2026-11-27'), out);
  assert.ok(out.includes('back 2026-12-01'));
});

t('the old bug: a cheaper wrong-date fare never displaces the right one', () => {
  // The exact failure. Sorted by price, so the wrong date came first and the
  // heading said 12 November over the top of it.
  const out = fareReport([
    row('2026-11-27', '2026-12-01', 610, 'AK'),
    row('2026-11-12', '2026-11-16', 890, 'MH'),
  ], Q, 'L');
  assert.ok(out.includes('RM890'), 'the right-date fare must be there');
  assert.ok(!out.includes('OTHER dates'), 'and the wrong-date one must not be offered');
  assert.ok(!out.includes('RM610'));
});

t('the right day but the wrong way back does not count', () => {
  const out = fareReport([row('2026-11-12', '2026-11-23', 700, 'AK')], Q, 'L');
  assert.ok(out.includes('NOTHING on 2026-11-12'), out);
});

t('one way only checks the outbound', () => {
  const out = fareReport([row('2026-11-12', null, 450, 'AK')],
    { from: 'KUL', to: 'CNX', date: '2026-11-12' }, 'L');
  assert.ok(out.includes('RM450'));
  assert.ok(!out.includes('NOTHING'));
});

t('no rows at all says so and stops', () => {
  const out = fareReport([], Q, 'L');
  assert.ok(out.includes('no fares found at all'));
  assert.ok(out.includes('rather than estimating'));
});

t('the booking link is always there', () => {
  assert.ok(fareReport([], Q, 'https://x/y').includes('https://x/y'));
  assert.ok(fareReport([row('2026-11-12', '2026-11-16', 890, 'AK')], Q, 'https://x/y')
    .includes('https://x/y'));
});

console.log('\nHotels');

t('the link takes city, which is what the schema sends', () => {
  const l = hotelSearchLink({ city: 'Chiang Mai', checkIn: '2026-11-12', checkOut: '2026-11-16' });
  assert.ok(l.includes('destination=Chiang+Mai'), l);
  assert.ok(l.includes('checkIn=2026-11-12'));
});

t('a hotel name alone still builds nothing — a link to the wrong town is worse', () => {
  assert.equal(hotelSearchLink({ hotel: 'Tamarind Village' }), '');
});


console.log('\nHotel rates');

// Shapes copied from a real Hotellook cache.json response. priceAvg is the
// average for the WHOLE STAY, which is the trap: quoting it per night makes a
// four-night trip look four times too dear.
const HQ = { city: 'Kuching', checkIn: '2026-09-08', checkOut: '2026-09-12' };
const H = [
  { hotelName: 'The Waterfront Hotel', stars: 4, priceAvg: 1200 },
  { hotelName: 'Sheraton Kuching Hotel', stars: 5, priceAvg: 2000 },
  { hotelName: 'The Ranee Boutique Suites', stars: 4, priceAvg: 1600 },
];

t('a stay average is turned into a nightly rate', () => {
  const out = hotelReport(H, HQ, 'L');
  assert.ok(out.includes('RM300/night'), out);         // 1200 over 4 nights
  assert.ok(out.includes('RM1,200 for 4 nights'), out);
});

t('the hotel they asked about comes first, not the cheapest', () => {
  // "How much for Sheraton" must not answer with three other hotels.
  const out = hotelReport(H, { ...HQ, hotel: 'Sheraton' }, 'L');
  const lines = out.split('\n').filter((l) => l.includes('/night'));
  assert.ok(lines[0].includes('Sheraton'), lines[0]);
});

t('and when it is not in the results, it says so instead of substituting', () => {
  const out = hotelReport(H, { ...HQ, hotel: 'Hilton' }, 'L');
  assert.ok(out.includes('nothing came back for "Hilton"'), out);
  assert.ok(out.includes('do not quote one of the above'));
});

t('otherwise cheapest first', () => {
  const lines = hotelReport(H, HQ, 'L').split('\n').filter((l) => l.includes('/night'));
  assert.ok(lines[0].includes('Waterfront'), lines[0]);
});

t('rows with no price at all are dropped, not shown as RM0', () => {
  const out = hotelReport([...H, { hotelName: 'Mystery Inn' }], HQ, 'L');
  assert.ok(!out.includes('Mystery Inn'), out);
});

t('nothing usable says so and still hands over the booking link', () => {
  const out = hotelReport([{ hotelName: 'X' }], HQ, 'https://book/me');
  assert.ok(out.includes('no usable prices'));
  assert.ok(out.includes('https://book/me'));
});

t('a one-night stay does not divide by zero', () => {
  const out = hotelReport(H, { ...HQ, checkOut: '2026-09-09' }, 'L');
  assert.ok(out.includes('1 night'), out);
  assert.ok(!out.includes('Infinity') && !out.includes('NaN'), out);
});

console.log('\n' + n + ' passed\n');
