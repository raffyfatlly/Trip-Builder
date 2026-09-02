// Every place in the trip gets a picture.
//
// raffy, 2026-09-02: "in the app, i want all places mention (ideas , itenary ,
// hotels) all have photos."
//
// The builder attaches one where it happens to look one up — across his three
// real trips that came to 10, 14 and 7 out of thirty-odd places, with Explore
// cards blank on a tab that is browsed by picture. Asking the builder to try
// harder is the move that has failed all day, so the app fills the gaps itself.
//
// What these tests are really guarding is the BILL: only real places, paid for
// once, bounded per pass.
//
//   node setup/test-photofill.mjs

import { photoGaps, applyFill, fillKey, fillPhotoGaps } from '../lib/photos.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

// Shaped after his Desaru trip, logistics rows and all.
const TRIP = {
  trip: { title: 'Desaru Coast' },
  stays: [{ n: 'Mandarin Oriental, Desaru Coast' }, { n: 'Anantara Desaru', photo: 'has-one' }],
  ideas: [{ n: 'Turmeric at Anantara' }, { n: 'Desaru Seafood Corner' }],
  days: [
    { items: [
      { h: 'Drive to Desaru' }, { h: 'Check in' }, { h: 'Desaru Fruit Farm' },
      { h: 'Early night' }, { h: 'Dinner at Desaru Seafood Corner' },
    ] },
    { items: [
      { h: 'Back to the pool' }, { h: 'Check out' }, { h: 'Adventure Waterpark' },
      { h: 'Drive home' }, { h: 'Turmeric at Anantara' },
    ] },
  ],
  photos: { 'has-one': 'https://img.test/anantara.jpg' },
};

{
  const gaps = photoGaps(TRIP).map((g) => g.name);
  console.log('');
  ok('the hotel with no picture is a gap', gaps.includes('Mandarin Oriental, Desaru Coast'));
  ok('so are the Explore ideas',
     gaps.includes('Turmeric at Anantara') && gaps.includes('Desaru Seafood Corner'));
  ok('and real places in the days', gaps.includes('Desaru Fruit Farm') && gaps.includes('Adventure Waterpark'));

  // The bill lives here. Every one of these would be a billed lookup returning
  // nothing anybody wants to look at.
  for (const junk of ['Drive to Desaru', 'Check in', 'Check out', 'Early night', 'Back to the pool', 'Drive home']) {
    ok('"' + junk + '" is not paid for', !gaps.includes(junk));
  }
  ok('a place that already has one is not paid for again',
     !gaps.includes('Anantara Desaru'));

  // Descriptions of an afternoon, taken verbatim from his three real trips.
  // Every one would have been a billed lookup returning nothing.
  const desc = photoGaps({ days: [{ items: [
    { h: 'Beach and pool' }, { h: 'Early dinner, easy night' },
    { h: 'Villa plunge pool, then the beach' }, { h: 'Easy morning at the apartment' },
    { h: 'Dinner — seafood or vegetable Italian' }, { h: 'Rooftop or terrace sunset aperitivo' },
  ] }] }).map((g) => g.name);
  ok('a description of an afternoon is not a place', desc.length === 0, desc.join(' | '));

  // And the ones that look similar but are real must survive it.
  const real = photoGaps({ days: [{ items: [
    { h: 'Marina Grande, Sorrento' }, { h: 'Satay by the Bay' },
    { h: 'Last Mandarin Oriental morning' }, { h: 'Adventure Waterpark' },
  ] }] }).map((g) => g.name);
  ok('but a real name with a comma in it survives', real.length === 4, real.join(' | '));

  // "Dinner at Desaru Seafood Corner" and the idea "Desaru Seafood Corner" are
  // the same restaurant twice. One lookup, not two.
  ok('the same place twice is one lookup',
     photoGaps(TRIP).filter((g) => /seafood corner/i.test(g.key)).length === 1,
     photoGaps(TRIP).map((g) => g.key).join(' | '));
}

// --- what a paid answer does once it exists ---------------------------------
{
  console.log('');
  const fill = {
    [fillKey('Mandarin Oriental, Desaru Coast')]: '/api/photo?ref=places/x/photos/y',
    [fillKey('Turmeric at Anantara')]: '/api/photo?ref=places/a/photos/b',
    [fillKey('Desaru Fruit Farm')]: '',      // Google knows no picture: remembered as a miss
  };
  const filled = applyFill(TRIP, fill);
  ok('the hotel gets its picture', !!filled.stays[0].photo);
  ok('and the URL lands in the photos map', !!filled.photos[filled.stays[0].photo]);
  ok('an Explore idea gets one', !!filled.ideas[0].photo);
  ok('a place Google has no picture of stays blank',
     !filled.days[0].items[2].photo);
  ok('and what the builder chose is untouched', filled.stays[1].photo === 'has-one');
  ok('logistics stay blank', !filled.days[0].items[0].photo && !filled.days[1].items[1].photo);

  // Applying it again must not multiply keys — this runs on every read.
  const twice = applyFill(filled, fill);
  ok('applying it twice changes nothing', Object.keys(twice.photos).length === Object.keys(filled.photos).length);
  ok('and it is a no-op with an empty store', applyFill(TRIP, {}) === TRIP);
}

// --- the money guards --------------------------------------------------------
{
  console.log('');
  // No key configured: it must not throw, and it must not invent anything.
  delete process.env.GOOGLE_PLACES_KEY;
  delete process.env.GOOGLE_MAPS_KEY;
  const same = { a: 'x' };
  ok('with no Places key it buys nothing', (await fillPhotoGaps(TRIP, same)) === same);

  // Everything already known: no lookups, same object back.
  const all = Object.fromEntries(photoGaps(TRIP).map((g) => [g.key, '']));
  const after = await fillPhotoGaps(TRIP, all);
  ok('a second pass over the same trip buys nothing',
     Object.keys(after).length === Object.keys(all).length);
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
