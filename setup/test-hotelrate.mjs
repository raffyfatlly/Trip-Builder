// Reading a hotel rate off a page, since there is no longer an API for one.
//
// Travelpayouts closed Hotellook and disabled its API; fourteen endpoints
// across three hosts all answer 404. raffy: "yeah build it." So the rate comes
// off the booking page now, and these check the parts that do not need network:
// the URL carries the dates, and every path that cannot produce a number says
// so instead of letting the agent invent one.
import assert from 'node:assert';
import { bookingPageFor, HOTEL_SOURCES, bySource, hotelAnswer, PRICE_TOOL } from '../lib/prices.js';

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


// --- three sites, not one ----------------------------------------------------
//
// raffy, 2026-09-07: "everytime it ask for hotel rates now, it says fully
// booked. just give the price range that's find from trusted source. always give
// source! when saying things like booking full or something. cause it might be
// available on other good sites. we are using shitty sites."
//
// One page was read, and a page that renders empty looks exactly like a hotel
// with no rooms. It is not the same thing, and these hold that line.

console.log('\nThree sources, each carrying the dates');
{
  const src = HOTEL_SOURCES({
    hotel: 'Ashley Wahid Hasyim', city: 'Jakarta',
    checkIn: '2026-11-12', checkOut: '2026-11-16', adults: 2,
  });
  t('three of them', () => assert.equal(src.length, 3));
  t('Booking, Agoda and Google Hotels', () => assert.deepEqual(
    src.map((x) => x.site), ['Booking.com', 'Agoda', 'Google Hotels']));
  t('every one is https, so Firecrawl will take it', () =>
    src.forEach((x) => assert.ok(x.url.startsWith('https://'), x.site + ': ' + x.url)));
  t('every one carries the check-in date', () =>
    src.forEach((x) => assert.ok(x.url.includes('2026-11-12'), x.site + ': ' + x.url)));
  t('Agoda gets a length of stay rather than a checkout', () =>
    assert.ok(src[1].url.includes('los=4'), src[1].url));
  t('Google Hotels gets both ends', () =>
    assert.ok(src[2].url.includes('2026-11-16'), src[2].url));
  t('the hotel name is in all three', () =>
    src.forEach((x) => assert.ok(/Ashley/.test(x.url), x.site + ': ' + x.url)));
}

console.log('\nEach answer keeps the site it came from');
{
  const src = [{ site: 'Booking.com' }, { site: 'Agoda' }, { site: 'Google Hotels' }];
  const blob = [
    '### On Booking.com: what does X cost?',
    'RM280 to RM410 per night.',
    '',
    '### On Agoda: what does X cost?',
    'Nothing usable found. Say so rather than guessing.',
    '',
    '### On Google Hotels: what does X cost?',
    'RM295 per night, whole stay RM1,180.',
  ].join('\n');
  const read = bySource(blob, src);
  t('one section per site, in order', () => assert.equal(read.length, 3));
  t('the rate lands under the site that quoted it', () =>
    assert.ok(read[0].body.includes('RM280'), read[0].body));
  t('an empty one is marked empty, not quoted', () =>
    assert.ok(read[1].empty && !read[0].empty && !read[2].empty));
  t('and the third is not shifted by the empty second', () =>
    assert.ok(read[2].body.includes('RM295'), read[2].body));
}

console.log('\nNothing found is never "fully booked"');
{
  const read = [
    { site: 'Booking.com', body: '', empty: true },
    { site: 'Agoda', body: '', empty: true },
    { site: 'Google Hotels', body: '', empty: true },
  ];
  const out = hotelAnswer({
    head: 'Ashley, Jakarta, 2026-11-12 to 2026-11-16', stay: '4 nights', read,
    link: 'https://www.booking.com/x', at: new Date('2026-09-07T10:22:00Z'),
  });
  t('it says outright not to call it sold out', () =>
    assert.ok(/DO NOT SAY IT IS FULLY BOOKED OR SOLD OUT/.test(out), out));
  t('it names every site it actually looked at', () =>
    ['Booking.com', 'Agoda', 'Google Hotels'].forEach((x) => assert.ok(out.includes(x), out)));
  t('it says when it looked', () => assert.ok(out.includes('2026-09-07 10:22 UTC'), out));
  t('it still forbids inventing a number', () =>
    assert.ok(/do NOT go and find one by web search/i.test(out), out));
  t('and it still hands over the link', () => assert.ok(out.includes('https://www.booking.com/x')));
}

console.log('\nOne empty site does not outvote a site with rooms');
{
  const read = [
    { site: 'Booking.com', body: '', empty: true },
    { site: 'Agoda', body: 'RM320 per night. Cheapest RM280, dearest RM460.', empty: false },
    { site: 'Google Hotels', body: '', empty: true },
  ];
  const out = hotelAnswer({
    head: 'Ashley, Jakarta', stay: '4 nights', read,
    link: 'https://www.booking.com/x', at: new Date('2026-09-07T10:22:00Z'),
  });
  t('the rate is reported', () => assert.ok(out.includes('RM320'), out));
  t('and the empty sites are reported as empty, not as sold out', () => {
    assert.ok(out.includes('Booking.com: showed no rate for these dates.'), out);
    assert.ok(!/FULLY BOOKED/.test(out), out);
  });
  t('with the rule that rooms beat an empty page', () =>
    assert.ok(/never call a place full because one site was empty/.test(out), out));
  t('and the instruction to name the site and the time', () =>
    assert.ok(/ALWAYS NAME THE SITE AND WHEN IT WAS READ/.test(out), out));
}

console.log('\nThe agent is told the same thing in the tool itself');
{
  const d = PRICE_TOOL.input_schema.properties.hotels.description;
  t('never say fully booked', () => assert.ok(/NEVER SAY A PLACE IS FULLY BOOKED/.test(d), d));
  t('always name the site and the time', () => assert.ok(/ALWAYS NAME THE SITE AND THE TIME/.test(d), d));
  t('give the range when they disagree', () => assert.ok(/RANGE across them/.test(d), d));
  t('and the three sites are named', () =>
    ['Booking.com', 'Agoda', 'Google Hotels'].forEach((x) => assert.ok(d.includes(x), d)));
}

console.log('\n' + n + ' passed');
