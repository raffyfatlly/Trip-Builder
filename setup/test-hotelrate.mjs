// Reading a hotel rate off a page, since there is no longer an API for one.
//
// Travelpayouts closed Hotellook and disabled its API; fourteen endpoints
// across three hosts all answer 404. raffy: "yeah build it." So the rate comes
// off the booking page now, and these check the parts that do not need network:
// the URL carries the dates, and every path that cannot produce a number says
// so instead of letting the agent invent one.
import assert from 'node:assert';
import { bookingPageFor, ratePagesFor, PRICE_TOOL } from '../lib/prices.js';
import { SYSTEM } from '../lib/prompt.js';

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


// --- one API, then the agent's own search --------------------------------
//
// raffy, 2026-09-07: "i want u remove all the so called Agoda booking and we
// just did ... I just google double tree Hilton melaka rates date bla bla and
// it gives out the prices with room across all platform. why cnt anthropic do
// the same. go with default first."
//
// The three-site scrape is gone. Reading Booking, Agoda and Google Hotels
// through a scraper was three ways to be handed a bot challenge and report it
// as "no rooms". What is left is LockTrip, and Anthropic's own web_search when
// LockTrip has not got it.

console.log('\nThe agent is told to search, not to give up');
{
  const d = PRICE_TOOL.input_schema.properties.hotels.description;
  t('it points at web_search by name', () => assert.ok(/web_search/.test(d), d));
  t('and web_fetch for the page detail', () => assert.ok(/web_fetch/.test(d), d));
  t('it still demands the site and the time', () =>
    assert.ok(/NAME THE SITE AND WHEN\s+YOU LOOKED/.test(d.replace(/\s+/g, ' ')) || /NAME THE SITE AND WHEN YOU LOOKED/.test(d.replace(/\s+/g, ' ')), d));
  t('and still forbids declaring a place full on one look', () =>
    assert.ok(/never say a place is fully booked on one look/i.test(d), d));
  t('the scraped sites are no longer named as sources', () =>
    assert.ok(!/Agoda/.test(d), d));
}

console.log('\nThe prompt no longer forbids the thing he asked for');
{
  t('searching for a rate is now instructed, not banned', () =>
    assert.ok(/GO AND SEARCH FOR IT/.test(SYSTEM), 'prompt does not tell it to search'));
  t('with the site and the time attached', () =>
    assert.ok(/Name the site and when you looked/.test(SYSTEM), 'no attribution rule'));
  t('and a blog is still not a rate', () =>
    assert.ok(/Never take a rate off a blog/.test(SYSTEM), 'blog rule missing'));
  t('the old blanket ban is gone', () =>
    assert.ok(!/Do not go and find a rate by web search instead/.test(SYSTEM), 'old ban still there'));
}

console.log('\nThe pages it is told to fetch carry the dates');
{
  const p = ratePagesFor({
    hotel: 'DoubleTree by Hilton Melaka', city: 'Melaka',
    checkIn: '2026-09-28', checkOut: '2026-09-29', adults: 2,
  });
  t('Google Hotels first — one page, every platform', () =>
    assert.equal(p[0].site, 'Google Hotels'));
  t('every page carries both dates', () => p.forEach((x) => {
    assert.ok(x.url.includes('2026-09-28'), x.site + ': ' + x.url);
  }));
  t('and asks for ringgit', () => assert.ok(/curr=MYR/.test(p[0].url), p[0].url));
  t('the hotel name is in all of them', () =>
    p.forEach((x) => assert.ok(/DoubleTree/i.test(decodeURIComponent(x.url)), x.site)));
  t('no dates, no pages — a link without them is not an answer', () =>
    assert.deepEqual(ratePagesFor({ hotel: 'X', city: 'Y' }), []));
}

console.log('\n' + n + ' passed');
