// Reading a hotel rate off a page, since there is no longer an API for one.
//
// Travelpayouts closed Hotellook and disabled its API; fourteen endpoints
// across three hosts all answer 404. raffy: "yeah build it." So the rate comes
// off the booking page now, and these check the parts that do not need network:
// the URL carries the dates, and every path that cannot produce a number says
// so instead of letting the agent invent one.
import assert from 'node:assert';
import { bookingPageFor } from '../lib/prices.js';

let n = 0;
const t = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };

console.log('\nThe page we read carries the dates');
{
  const u = new URL(bookingPageFor({
    hotel: 'Sheraton', city: 'Kuching', checkIn: '2026-10-14', checkOut: '2026-10-17', adults: 2,
  }));
  t('the dates are in the URL, which is the whole point', () => {
    assert.equal(u.searchParams.get('checkin'), '2026-10-14');
    assert.equal(u.searchParams.get('checkout'), '2026-10-17');
  });
  t('the hotel and the city are both in the search', () => {
    assert.equal(u.searchParams.get('ss'), 'Sheraton, Kuching');
  });
  t('prices come back in ringgit', () => {
    assert.equal(u.searchParams.get('selected_currency'), 'MYR');
  });
  t('the party size is carried, and clamped to something sane', () => {
    assert.equal(u.searchParams.get('group_adults'), '2');
    assert.equal(new URL(bookingPageFor({
      city: 'Kuching', checkIn: '2026-10-14', checkOut: '2026-10-17', adults: 99,
    })).searchParams.get('group_adults'), '9');
    assert.equal(new URL(bookingPageFor({
      city: 'Kuching', checkIn: '2026-10-14', checkOut: '2026-10-17', adults: 0,
    })).searchParams.get('group_adults'), '1');
  });
  t('a city with no named hotel still builds a page', () => {
    const c = new URL(bookingPageFor({ city: 'Kuching', checkIn: '2026-10-14', checkOut: '2026-10-17' }));
    assert.equal(c.searchParams.get('ss'), 'Kuching');
  });
}

console.log('\nNothing to read means nothing is built');
{
  // Every one of these used to be a chance for the agent to fall back on a
  // number off a blog. A page it cannot build is a page it cannot read, and
  // that has to be visible rather than silent.
  t('no dates, no page', () => {
    assert.equal(bookingPageFor({ hotel: 'Sheraton', city: 'Kuching' }), '');
    assert.equal(bookingPageFor({ city: 'Kuching', checkIn: 'next week', checkOut: '2026-10-17' }), '');
  });
  t('no place at all, no page', () => {
    assert.equal(bookingPageFor({ checkIn: '2026-10-14', checkOut: '2026-10-17' }), '');
  });
  t('it is always https, so Firecrawl will take it', () => {
    assert.ok(bookingPageFor({
      city: 'Kuching', checkIn: '2026-10-14', checkOut: '2026-10-17',
    }).startsWith('https://'));
  });
}

console.log('\n' + n + ' passed');
