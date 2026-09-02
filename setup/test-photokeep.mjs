// Photos surviving a rebuild.
//
// raffy, 2026-09-02: "some photos are missing the built app (hotel) then when i
// say it rebuild . when it rebuild hotel photo is there , but the other photos
// goes missing. how to make sure the completed app has all the photos it
// suggested or put of the places"
//
// The photos MAP already survived a rebuild — that was deliberate, they cost
// real research to find. What did not survive was the ATTACHMENT: `photo: key`
// lives on the stay, the item and the idea, and save_itinerary replaces those
// arrays wholesale. Every rebuild wiped the labels and kept the pictures.
//
//   node setup/test-photokeep.mjs

import { applyEdit } from '../lib/itinerary.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const PHOTOS = {
  furama: 'https://img.test/furama.jpg',
  marble: 'https://img.test/marble.jpg',
  bridge: 'https://img.test/bridge.jpg',
  hero: 'https://img.test/hero.jpg',
};

// A trip that has been through find_photos: everything is labelled.
const built = applyEdit(null, 'save_itinerary', {
  trip: { title: 'Da Nang', feature: { h: 'Four days', photo: 'hero' } },
  stays: [{ n: 'Furama Resort Danang', photo: 'furama', credit: 'A photographer' }],
  days: [{ dow: 'Thu', items: [
    { h: 'Marble Mountains', photo: 'marble' },
    { h: 'Coffee at Cong', t: '9:00am' },
  ] }],
  ideas: [{ n: 'Dragon Bridge', photo: 'bridge' }],
  photos: PHOTOS,
});

ok('the first build labels everything', built.stays[0].photo === 'furama'
   && built.days[0].items[0].photo === 'marble' && built.ideas[0].photo === 'bridge');

// The rebuild the agent actually sends: the same places, no photo keys on them,
// because save_itinerary is written fresh each time.
const rebuilt = applyEdit(built, 'save_itinerary', {
  trip: { title: 'Da Nang', feature: { h: 'Four days, rearranged' } },
  stays: [{ n: 'Furama Resort Danang' }],
  days: [{ dow: 'Thu', items: [
    { h: 'Coffee at Cong', t: '8:30am' },
    { h: 'Marble Mountains' },
  ] }],
  ideas: [{ n: 'Dragon Bridge' }],
});

console.log('');
ok('the pictures are still in the map', Object.keys(rebuilt.photos).length === 4);
ok('the hotel keeps its photo', rebuilt.stays[0].photo === 'furama');
ok('and its credit with it', rebuilt.stays[0].credit === 'A photographer');
// The item moved from index 0 to index 1 — matched by name, not by position,
// because a rebuild is exactly when things move.
ok('a day item keeps its photo even though it moved',
   rebuilt.days[0].items[1].photo === 'marble',
   JSON.stringify(rebuilt.days[0].items));
ok('an idea keeps its photo', rebuilt.ideas[0].photo === 'bridge');
ok('and so does the feature card', rebuilt.trip.feature.photo === 'hero');
ok('while the new text is kept', rebuilt.trip.feature.h === 'Four days, rearranged');

// A fresh choice must win: relabelling fills gaps, it does not overrule.
const withNew = applyEdit(built, 'save_itinerary', {
  trip: { title: 'Da Nang' },
  stays: [{ n: 'Furama Resort Danang', photo: 'newshot' }],
  days: [], ideas: [],
  photos: { newshot: 'https://img.test/new.jpg' },
});
console.log('');
ok('a photo the rebuild chose itself wins', withNew.stays[0].photo === 'newshot');

// Something genuinely new gets nothing rather than somebody else's picture.
const different = applyEdit(built, 'save_itinerary', {
  trip: { title: 'Da Nang' },
  stays: [{ n: 'La Siesta Hoi An' }],
  days: [{ dow: 'Fri', items: [{ h: 'Somewhere else entirely' }] }],
  ideas: [],
});
ok('a place that was not there before gets no photo', !different.stays[0].photo);
ok('and neither does a new item', !different.days[0].items[0].photo);

// A key that is no longer in the map must not be reattached: a dangling key
// renders as a broken picture, which is worse than none.
const dropped = applyEdit({ ...built, photos: { hero: PHOTOS.hero } }, 'save_itinerary', {
  trip: { title: 'Da Nang' }, stays: [{ n: 'Furama Resort Danang' }], days: [], ideas: [],
});
ok('a key whose picture is gone is not reattached', !dropped.stays[0].photo);

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
