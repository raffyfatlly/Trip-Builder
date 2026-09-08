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
import { fareReport, hotelSearchLink } from '../lib/prices.js';

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
  assert.ok(!out.includes('No cached fare ON'));
  assert.ok(!out.includes('OTHER dates'));
});

t('nothing on the date is said outright, not papered over', () => {
  const out = fareReport([row('2026-11-27', '2026-12-01', 610, 'AK')], Q, 'L');
  assert.ok(out.includes('No cached fare ON 2026-11-12'), out);
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
  assert.ok(out.includes('No cached fare ON 2026-11-12'), out);
});

t('one way only checks the outbound', () => {
  const out = fareReport([row('2026-11-12', null, 450, 'AK')],
    { from: 'KUL', to: 'CNX', date: '2026-11-12' }, 'L');
  assert.ok(out.includes('RM450'));
  assert.ok(!out.includes('No cached fare ON'));
});

// raffy, 2026-09-08, with a screenshot of "there are no flights available on
// September 10 from KUL to BKK": an empty cache was being reported as an empty
// sky. This is the guard on that.
t('an empty answer is never allowed to read as "no flights"', () => {
  const out = fareReport([], Q, 'L');
  assert.ok(out.includes('THIS IS NOT AN AVAILABILITY CHECK'), out);
  assert.ok(/never that the flight is full, sold out or unavailable/.test(out), out);
  assert.ok(out.includes('link'), out);
});

t('and neither is an empty DAY inside a month that has fares', () => {
  const out = fareReport([row('2026-11-27', '2026-12-01', 610, 'AK')], Q, 'L');
  assert.ok(out.includes('do not tell them there are no flights that day'), out);
});

t('the booking link is always there', () => {
  assert.ok(fareReport([], Q, 'https://x/y').includes('https://x/y'));
  assert.ok(fareReport([row('2026-11-12', '2026-11-16', 890, 'AK')], Q, 'https://x/y')
    .includes('https://x/y'));
});

console.log('\nHotels');

// It points at Booking.com now, not hotellook. raffy, 2026-09-07: "we are using
// shitty sites." Hotellook is the service Travelpayouts shut down; sending the
// To do list's "book a hotel" row there was sending people nowhere useful. It
// now opens the same page the rate is read off, so the number and the link agree.
t('the link takes city, which is what the schema sends', () => {
  const l = hotelSearchLink({ city: 'Chiang Mai', checkIn: '2026-11-12', checkOut: '2026-11-16' });
  assert.ok(l.startsWith('https://www.booking.com/'), l);
  assert.ok(l.includes('ss=Chiang+Mai'), l);
  assert.ok(l.includes('checkin=2026-11-12'), l);
  assert.ok(l.includes('checkout=2026-11-16'), l);
});

t('a named hotel narrows the same search rather than replacing the town', () => {
  const l = hotelSearchLink({ city: 'Chiang Mai', hotel: 'Tamarind Village', checkIn: '2026-11-12', checkOut: '2026-11-16' });
  assert.ok(l.includes('Tamarind+Village'), l);
  assert.ok(l.includes('Chiang+Mai'), l);
});

t('a hotel name alone still builds nothing — a link to the wrong town is worse', () => {
  assert.equal(hotelSearchLink({ hotel: 'Tamarind Village' }), '');
});



// The hotel-rate tests were removed with hotelReport(): Travelpayouts closed
// Hotellook and disabled its API, so there is no hotel price feed to parse and
// a passing test on an unreachable parser would only say "hotels work". They
// don't. lib/prices.js keeps the two lessons those tests encoded, in prose,
// for whatever provider comes next.

console.log('\n' + n + ' passed\n');
