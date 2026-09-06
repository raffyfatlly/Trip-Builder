// Which places get a landmark glyph, and which correctly get nothing.
//
// The matcher here is the SAME function that ships inside the generated app —
// iconsJs() serialises it with toString() — so these assertions cover the code
// that runs on a traveller's phone rather than a Node-side copy of it.

import assert from 'node:assert';
import { GLYPHS, NAMED, CATS, iconNameFor, iconsJs } from '../renderer/icons.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const is = (place, want) => assert.equal(iconNameFor(place), want,
  place + ' -> ' + iconNameFor(place) + ', wanted ' + want);

console.log('\nNamed landmarks');
t('his own two examples', () => {
  is('Eiffel Tower', 'eiffel');
  is('Petronas Twin Towers', 'petronas');
  is('KLCC Park', 'petronas');       // named beats the "park" category
});
t('and the rest of the set', () => {
  is('The Colosseum', 'colosseum');
  is('Sagrada Familia', 'sagrada');
  is('Tokyo Skytree', 'skytree');
  is('Mount Fuji', 'fuji');
  is('Angkor Wat', 'angkor');        // named beats "wat"
  is('Wat Arun', 'watarun');
  is('Sydney Opera House', 'operahouse');
  is('Borobudur Temple', 'borobudur');
});

console.log('\nCategories — the ones that cover everywhere else');
t('a trip to Chiang Mai', () => {
  is('Wat Phra Singh', 'temple');
  is('Doi Suthep', 'mountain');
  is('Chiang Mai Night Bazaar', 'market');
  is('Sticky Waterfall', 'waterfall');
});
t('and one in Malay and Indonesian', () => {
  is('Pantai Cenang', 'beach');
  is('Gunung Mulu', 'mountain');
  is('Masjid Jamek', 'mosque');
  is('Taman Negara', 'park');
  is('Pasar Seni', 'market');
  is('Air Terjun Telaga Tujuh', 'waterfall');
});

console.log('\nWhat must NOT get an icon');
t('a place we do not recognise keeps its plain ring', () => {
  is('Nowhere in particular', '');
  is('Dinner with Aisyah', '');
  is('', '');
  is(null, '');
});
t('a category word inside another word does not fire', () => {
  // "Spain" is not a spa, "Marketing Museum" is a museum, "Barcelona" is not a
  // bar. Substring matching on categories would have got all three wrong.
  is('Spain', '');
  is('Barcelona', '');
  assert.equal(iconNameFor('Marketing Museum'), 'museum');
});

console.log('\nThe table itself');
t('every mapping points at a glyph that exists', () => {
  const missing = [...NAMED, ...CATS].filter(([, g]) => !GLYPHS[g]);
  assert.deepEqual(missing, []);
});
t('a good amount, and not more', () => {
  // "not just one but good amount . but not too overwhelming" — enough to
  // cover a real trip, small enough that every one was looked at on a
  // contact sheet before it shipped (shots/icons.png).
  assert.ok(Object.keys(GLYPHS).length >= 40, String(Object.keys(GLYPHS).length));
  assert.ok(Object.keys(GLYPHS).length <= 70, String(Object.keys(GLYPHS).length));
});
t('every glyph is a bare path, no markup smuggled in', () => {
  for (const [k, d] of Object.entries(GLYPHS)) {
    assert.ok(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\-\s]+$/.test(d), k + ': ' + d);
    assert.ok(d.length < 400, k + ' is too detailed for 16px');
  }
});

console.log('\nWhat gets spliced into the app');
t('the shipped source carries the same matcher', () => {
  const src = iconsJs();
  assert.ok(src.includes('function iconFor'));
  assert.ok(src.includes('function glyphFor'));
  assert.ok(!src.includes('export '), 'an export keyword would be a SyntaxError there');
  // The template literal it is concatenated into cannot survive either of
  // these. Both have broken this build before.
  assert.ok(!src.includes('`'), 'no backticks');
  assert.ok(!src.includes('${'), 'no dollar-brace');
});
t('and it actually runs, giving the same answers', () => {
  const run = new Function(iconsJs() + '\nreturn glyphFor;')();
  assert.equal(run('Eiffel Tower'), GLYPHS.eiffel);
  assert.equal(run('Wat Phra Singh'), GLYPHS.temple);
  assert.equal(run('Nowhere in particular'), '');
});

console.log('\n' + n + ' passed\n');
