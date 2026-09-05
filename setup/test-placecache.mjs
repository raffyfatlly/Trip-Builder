// Does the place cache actually stop us paying twice?
//
// The numbers in here are the real ones: these are the exact query strings the
// Chiang Mai run sent, read out of the Managed Agents event log. The test
// counts how many of them would reach Google now, and fails if that number
// creeps back up.
//
//   node setup/test-placecache.mjs

import assert from 'assert';
import { placeKey, loosely, unqualified, cached, PHOTOS_NS, _forget } from '../lib/placecache.js';

let fail = 0;
const ok = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
};
const okAsync = async (name, fn) => {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
};

console.log('\nnormalising');

ok('a comma is not a different place', () => {
  assert.equal(placeKey('Wat Phra Singh Chiang Mai'), placeKey('Wat Phra Singh, Chiang Mai'));
});

ok('case and spacing collapse', () => {
  assert.equal(placeKey('  PASTELL   Oldtown  '), 'pastell oldtown');
});

ok('accents fold, including Vietnamese d-stroke', () => {
  assert.equal(placeKey('Hội An Café, Đà Nẵng'), placeKey('Hoi An Cafe, Da Nang'));
});

ok('a trailing generic noun is dropped', () => {
  assert.equal(loosely(placeKey('Wat Phra Singh Chiang Mai temple')),
               placeKey('Wat Phra Singh Chiang Mai'));
});

ok('a short name is never eroded', () => {
  assert.equal(loosely('old city'), 'old city');
  assert.equal(loosely('night market'), 'night market');
  assert.equal(loosely('chiang mai market'), 'chiang mai market');
});

ok('only one word comes off, so a real name survives', () => {
  // Temple Street Night Market is a place in Hong Kong. Stripping the whole
  // trailing run left "temple street", which is somewhere else.
  assert.notEqual(loosely('temple street night market'), 'temple street');
  assert.equal(loosely('temple street night market'), 'temple street night');
});

console.log('\nnot paying twice');

await okAsync('a second identical lookup does not call Google', async () => {
  _forget();
  let calls = 0;
  const get = () => cached('Wat Phra Singh, Chiang Mai', async () => { calls++; return { name: 'Wat Phra Singh' }; });
  await get(); await get();
  assert.equal(calls, 1, 'called Google ' + calls + ' times');
});

await okAsync('a comma variant hits the same entry', async () => {
  _forget();
  let calls = 0;
  const f = async () => { calls++; return { name: 'Wat Phra Singh' }; };
  await cached('Wat Phra Singh Chiang Mai', f);
  await cached('Wat Phra Singh, Chiang Mai', f);
  assert.equal(calls, 1);
});

await okAsync('a null answer is cached too', async () => {
  _forget();
  let calls = 0;
  const f = async () => { calls++; return null; };
  await cached('Somewhere Google Has Never Heard Of', f);
  const second = await cached('somewhere google has never heard of', f);
  assert.equal(calls, 1, 'a miss was re-bought');
  assert.equal(second, null);
});

await okAsync('a photo search reuses a lookup already paid for', async () => {
  _forget();
  let lookups = 0, photos = 0;
  await cached('Wat Phra Singh Chiang Mai', async () => { lookups++; return { name: 'Wat Phra Singh', photo: '/api/photo?ref=x' }; });
  const got = await cached('Wat Phra Singh Chiang Mai temple', async () => { photos++; return []; },
    { ns: PHOTOS_NS, alsoTry: loosely(placeKey('Wat Phra Singh Chiang Mai temple')) });
  assert.equal(lookups, 1);
  assert.equal(photos, 0, 'paid for a photo search of a place already in the cache');
  assert.ok(got && got.photo, 'got the cached place back');
});

await okAsync('a lookup is NEVER handed a photo search result', async () => {
  // The dangerous direction. A photo list matched onto a details lookup would
  // put the wrong opening hours on a card, which is the one thing the app
  // must not do. Different namespaces, so this cannot happen.
  _forget();
  let lookups = 0;
  await cached('Warorot Market Chiang Mai', async () => [{ url: 'a photo' }], { ns: PHOTOS_NS });
  const out = await cached('Warorot Market Chiang Mai', async () => { lookups++; return { name: 'Warorot Market', hours: ['Mon 6am-6pm'] }; });
  assert.equal(lookups, 1, 'the lookup was served from the photo namespace');
  assert.ok(out && out.hours, 'got a place, not a photo list');
});

ok('a trailing country comes off', () => {
  assert.equal(unqualified(placeKey('Tam Coc Garden Resort Ninh Binh, Vietnam')),
               placeKey('Tam Coc Garden Resort Ninh Binh'));
});

ok('but not off a short name', () => {
  assert.equal(unqualified('hanoi vietnam'), 'hanoi vietnam');
  assert.equal(unqualified('little vietnam'), 'little vietnam');
});

ok('country and generic noun both come off a photo search', () => {
  assert.equal(loosely(placeKey('Pastell Oldtown Chiang Mai, Thailand hotel')),
               placeKey('Pastell Oldtown Chiang Mai'));
});

await okAsync('eight parallel lookups of one place buy it once', async () => {
  // travel_time resolves both ends of every leg in one Promise.all. Before the
  // cache held in-flight promises, the Hanoi run on 2026-09-05 paid for Noi Bai
  // airport twice, Hanoi Old Quarter twice and Tam Coc twice — all races, all
  // invisible in the totals.
  _forget();
  let calls = 0;
  const f = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return { name: 'Noi Bai' }; };
  const got = await Promise.all(Array.from({ length: 8 }, () =>
    cached('Noi Bai International Airport, Hanoi, Vietnam', f)));
  assert.equal(calls, 1, 'raced and paid ' + calls + ' times');
  assert.ok(got.every((g) => g && g.name === 'Noi Bai'));
});

await okAsync('a failed lookup is not remembered as a miss', async () => {
  _forget();
  let calls = 0;
  const boom = async () => { calls++; throw new Error('places 503'); };
  await cached('Somewhere', boom).catch(() => {});
  await cached('Somewhere', async () => { calls++; return { name: 'Somewhere' }; });
  assert.equal(calls, 2, 'an outage was cached as "this place does not exist"');
});

console.log('\nthe Chiang Mai run, replayed');

// Every place query that run actually sent, in order, tagged with which tool
// sent it. Read out of the Managed Agents event log for sessions
// sesn_01HXT4dsbc6y7bUSWfzbz9xR (chat) and sesn_017M3spbDgCZqB9aevXWJF9u (build).
const RUN = [
  // place_details, 20 places
  ['d', 'Rachamankha Hotel Chiang Mai Old City'], ['d', 'Pastell Oldtown Chiang Mai Old City'],
  ['d', 'Tamarind Village Chiang Mai Old City'], ['d', 'De Lanna Hotel Chiang Mai Old City'],
  ['d', 'El Barrio Lanna Hotel Chiang Mai Old City'], ['d', 'Aksara Heritage Hotel Chiang Mai Old City'],
  ['d', 'Wat Phra Singh Chiang Mai'], ['d', 'Wat Chedi Luang Chiang Mai'],
  ['d', 'Wat Chiang Man Chiang Mai'], ['d', 'Warorot Market Chiang Mai'],
  ['d', 'Wat Phra That Doi Suthep Chiang Mai'], ['d', 'Chiang Mai National Museum Chiang Mai'],
  ['d', 'Chiang Mai City Arts and Cultural Centre Chiang Mai'], ['d', 'Three Kings Monument Chiang Mai'],
  ['d', 'Lanna Folklife Museum Chiang Mai'], ['d', 'Khao Soi Mae Sai Chiang Mai'],
  ['d', 'Khao Soi Khun Yai Chiang Mai'], ['d', 'Saturday Walking Street Wua Lai Chiang Mai'],
  ['d', 'Huen Phen Restaurant Chiang Mai'], ['d', 'Sunday Walking Street Ratchadamnoen Road Chiang Mai'],
  // travel_time, 8 legs x 2 endpoints
  ['d', 'Pastell Oldtown Chiang Mai'], ['d', 'Wat Phra Singh, Chiang Mai'],
  ['d', 'Pastell Oldtown Chiang Mai'], ['d', 'Wat Chedi Luang, Chiang Mai'],
  ['d', 'Pastell Oldtown Chiang Mai'], ['d', 'Warorot Market, Chiang Mai'],
  ['d', 'Pastell Oldtown Chiang Mai'], ['d', 'Wat Phra That Doi Suthep, Chiang Mai'],
  ['d', 'Pastell Oldtown Chiang Mai'], ['d', 'Wat Chiang Man, Chiang Mai'],
  ['d', 'Pastell Oldtown Chiang Mai'], ['d', 'Wua Lai Road, Chiang Mai'],
  ['d', 'Chiang Mai International Airport'], ['d', 'Pastell Oldtown Chiang Mai'],
  ['d', 'Chiang Mai International Airport'], ['d', 'Pastell Oldtown Chiang Mai, Samlan Soi 7'],
  // find_photos, 15 queries
  ['p', 'Pastell Oldtown Chiang Mai hotel'], ['p', 'Wat Phra Singh Chiang Mai temple'],
  ['p', 'Wat Chedi Luang Chiang Mai'], ['p', 'Three Kings Monument Chiang Mai'],
  ['p', 'Wat Phra That Doi Suthep golden chedi'], ['p', 'Saturday Walking Street Wua Lai Road Chiang Mai'],
  ['p', 'Warorot Market Chiang Mai'], ['p', 'Sunday Walking Street Ratchadamnoen Road Chiang Mai'],
  ['p', 'Wat Chiang Man Chiang Mai temple'], ['p', 'Wat Suan Dok Chiang Mai white chedis'],
  ['p', 'Wat Umong tunnel temple Chiang Mai'], ['p', 'Nimmanhaemin Road Chiang Mai cafe street'],
  ['p', 'Elephant Nature Park Chiang Mai'], ['p', 'Bhubing Palace Chiang Mai gardens'],
  ['p', 'Baan Kang Wat creative village Chiang Mai'],
];

const RATE = 0.032;

await okAsync('the same run costs less than it did', async () => {
  _forget();
  let billed = 0;
  for (const [kind, q] of RUN) {
    if (kind === 'd') {
      await cached(q, async () => { billed++; return { name: q, photo: '/api/photo?ref=x' }; });
    } else {
      await cached(q, async () => { billed++; return [{ url: 'x' }]; },
        { ns: PHOTOS_NS, alsoTry: loosely(placeKey(q)) });
    }
  }
  const was = RUN.length;
  console.log('       was ' + was + ' billed calls ($' + (was * RATE).toFixed(2) + '), '
    + 'now ' + billed + ' ($' + (billed * RATE).toFixed(2) + ') '
    + '— ' + Math.round((1 - billed / was) * 100) + '% off, cold cache');
  assert.ok(billed <= 32, 'expected 32 or fewer billed calls, got ' + billed);
});

await okAsync('the second person to plan Chiang Mai pays nothing', async () => {
  // Same run again without clearing: this is what a warm cache looks like, and
  // it is the case that matters once more than one person uses the app.
  let billed = 0;
  for (const [kind, q] of RUN) {
    if (kind === 'd') await cached(q, async () => { billed++; return {}; });
    else await cached(q, async () => { billed++; return []; },
      { ns: PHOTOS_NS, alsoTry: loosely(placeKey(q)) });
  }
  console.log('       warm cache: ' + billed + ' billed calls');
  assert.equal(billed, 0);
});

console.log(fail ? '\n' + fail + ' failed\n' : '\nall good\n');
process.exit(fail ? 1 : 0);
