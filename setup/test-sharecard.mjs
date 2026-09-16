// What a shared link says about itself before anyone clicks it.
//
// raffy, 2026-09-16: "something that intrigue people to open the link when
// shared." The card's pull is the teaser line — three real places and a count
// of what is not shown — so the rules about which three, and what the count
// means, are worth holding still.
//
//   node setup/test-sharecard.mjs

import { when, facts, teaser, cover, shareCard, planningCard } from '../lib/sharecard.js';
import { sign, signed } from '../lib/ogsign.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const IT = {
  trip: { title: 'Istanbul', start: '2027-11-13', end: '2027-11-20', feature: { photo: 'hero' } },
  stays: [{ n: 'Cousin\'s place' }, { n: 'Schloss Lieser' }],
  photos: { hero: 'https://a-hotel.example/hero.jpg', bazaar: '/api/photo?ref=places%2Fabcd%2Fphotos%2Fefgh' },
  days: [
    { items: [{ h: 'Hagia Sophia', major: true }, { h: 'Coffee at Mandabatmaz' }] },
    { items: [{ h: 'Bosphorus ferry at sunset', major: true }, { h: 'Grand Bazaar' }] },
    { items: [{ h: 'Check out of the hotel and drive the long way back to Idstein' }] },
  ],
};

console.log('\nThe dates line');
ok('one month reads as a range', when('2027-11-13', '2027-11-20') === '13–20 November',
   when('2027-11-13', '2027-11-20'));
ok('across two, both are named', when('2027-11-28', '2027-12-03') === '28 Nov – 3 Dec',
   when('2027-11-28', '2027-12-03'));
// Date parsing through Date() would shift this to 31 October for anyone west
// of London, and put the trip in the wrong month on the card.
ok('the first of the month stays the first', when('2027-11-01', '2027-11-04') === '1–4 November',
   when('2027-11-01', '2027-11-04'));
ok('no dates is no line, not "Invalid Date"', when('', '') === '');
ok('rubbish in is nothing out', when('soon', 'later') === '');

console.log('\nThe facts line');
ok('days, dates and stays', facts(IT) === '3 days · 13–20 November · 2 stays', facts(IT));
ok('one of a thing is singular',
   facts({ trip: {}, days: [{}], stays: [{}] }) === '1 day · 1 stay',
   facts({ trip: {}, days: [{}], stays: [{}] }));
ok('no stays, no stays clause', facts({ trip: {}, days: [{}, {}] }) === '2 days');

console.log('\nThe teaser, which is the whole reason anybody taps');
const t = teaser(IT);
ok('the anchor moments at real places lead',
   t.startsWith('Hagia Sophia · Bosphorus ferry'), t);
ok('a long chore is never one of the three', !t.includes('drive the long way'), t);
ok('and the rest are counted, not listed', t.endsWith('· +2 more'), t);
ok('an empty trip teases nothing rather than crashing', teaser({}) === '');
ok('no count when there is nothing left over',
   teaser({ days: [{ items: [{ h: 'One thing' }] }] }) === 'One thing',
   teaser({ days: [{ items: [{ h: 'One thing' }] }] }));
ok('the same place twice is named once',
   teaser({ days: [{ items: [{ h: 'A' }, { h: 'A' }, { h: 'B' }] }] }) === 'A · B · +1 more',
   teaser({ days: [{ items: [{ h: 'A' }, { h: 'A' }, { h: 'B' }] }] }));

// The first card this code ever built, for a real week on the Amalfi coast,
// opened with "Depart KLIA for Naples · Land in Naples · Circumvesuviana to
// Pompeii". Every itinerary starts with a flight, so reading the days in
// order sells somebody their own airport.
const AMALFI = {
  days: [
    { items: [
      { h: 'Depart KLIA for Naples' },
      { h: 'Land in Naples', photo: 'n' },
      { h: 'Check in to Casa Angelina', photo: 'c' },
    ] },
    { items: [
      { h: 'Pompeii', major: true, photo: 'p' },
      { h: 'Lunch in Sorrento' },
    ] },
    { items: [
      { h: 'Amalfi Cathedral', major: true, photo: 'a' },
      { h: 'Ravello gardens', major: true, photo: 'r' },
      { h: 'Check out and fly home' },
    ] },
  ],
};
const am = teaser(AMALFI);
ok('the airport is not the holiday', !/Depart|Land in|Check in|Check out/.test(am), am);
ok('the anchors are', am.startsWith('Pompeii · Amalfi Cathedral · Ravello gardens'), am);
ok('and everything else is the count', am.endsWith('· +5 more'), am);

// A trip of nothing but logistics still has to say something rather than
// coming back empty and dropping the line off the card.
const ALL_CHORES = { days: [{ items: [{ h: 'Depart KLIA' }, { h: 'Land in Rome' }] }] };
ok('all-logistics falls back rather than blanking',
   teaser(ALL_CHORES) === 'Depart KLIA · Land in Rome', teaser(ALL_CHORES));

ok('the line stays within its budget',
   teaser({ days: [{ items: [
     { h: 'A morning at the Alhambra palace' },
     { h: 'Sunset over the Albaicin quarter' },
     { h: 'Tapas' },
   ] }] }).length <= 76,
   teaser({ days: [{ items: [
     { h: 'A morning at the Alhambra palace' },
     { h: 'Sunset over the Albaicin quarter' },
     { h: 'Tapas' },
   ] }] }));

console.log('\nThe cover');
ok('the hero wins', cover(IT) === 'https://a-hotel.example/hero.jpg', cover(IT));
ok('a Places photo goes back to being a reference',
   cover({ photos: { a: '/api/photo?ref=places%2Fabcd%2Fphotos%2Fefgh' } }) === 'places/abcd/photos/efgh',
   cover({ photos: { a: '/api/photo?ref=places%2Fabcd%2Fphotos%2Fefgh' } }));
ok('any photo beats none when the hero is missing',
   cover({ trip: {}, photos: { b: 'https://x.example/b.jpg' } }) === 'https://x.example/b.jpg');
ok('no photos is no cover', cover({ trip: {} }) === '');
// http:// and data: would both be fetched by the card if they got through.
ok('an insecure url is not a cover', cover({ photos: { a: 'http://x.example/b.jpg' } }) === '');

console.log('\nThe signature, which is what lets any hero be used at all');
const url = 'https://a-hotel.example/hero.jpg';
const tag = await sign(url);
ok('a tag verifies', await signed(url, tag));
ok('a tag does not carry to another url', !(await signed('https://evil.example/x.jpg', tag)));
ok('no tag, no photo', !(await signed(url, '')));
ok('a wrong tag of the right length fails', !(await signed(url, 'x'.repeat(tag.length))));

console.log('\nThe whole card');
const card = await shareCard(IT, 'https://trip.example', 'https://trip.example/t/abc');
ok('the title is the trip', card.title === 'Istanbul');
ok('the description carries the teaser too', card.description.includes('+2 more'), card.description);
ok('the image is the card route', card.image.startsWith('https://trip.example/api/og?'));
ok('and it carries a signed photo', card.image.includes('k=') && card.image.includes('p=https'));

const early = planningCard({ destination: 'Istanbul, Turkey', dates: 'Seven nights in November' },
                           'https://trip.example', 'https://trip.example/t/abc');
ok('a trip shared early is named, not blanked', early.title === 'Istanbul', early.title);
ok('and says so on the card', early.image.includes('s=planning'));
ok('with no destination it still says something',
   planningCard({}, 'https://trip.example', 'u').title === 'A trip in the making');

console.log(fail ? '\n' + fail + ' failed' : '\nall passed');
process.exit(fail ? 1 : 0);
