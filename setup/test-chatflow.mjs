// The three chat-flow changes of 2026-09-06, tested where they can actually
// fail: list parsing, the triaged reply, and the build stages.
//
// Each assertion below was checked against the OLD code first — every one of
// them fails there. A test that passes on the code it is meant to protect
// against is worse than no test, which this session already learned once.

import assert from 'node:assert';
import { parse } from '../lib/richtext.js';
import { triageMessage } from '../lib/triage.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

console.log('\nRich — numbered lists');

t('a numbered list is a list, not four paragraphs', () => {
  const b = parse('Three to book:\n1. Cooking class\n2. Night market\n3. The waterfall');
  assert.equal(b.length, 2);
  assert.equal(b[0].type, 'p');
  assert.equal(b[1].type, 'ol');
  assert.deepEqual(b[1].items, ['Cooking class', 'Night market', 'The waterfall']);
});

t('1) is a list too', () => {
  const b = parse('1) One\n2) Two');
  assert.equal(b[0].type, 'ol');
  assert.equal(b[0].items.length, 2);
});

t('dashes still work and stay a ul', () => {
  const b = parse('- Alpha\n- Beta');
  assert.equal(b[0].type, 'ul');
});

t('a marker change starts a second list', () => {
  const b = parse('- Alpha\n1. One');
  assert.deepEqual(b.map((x) => x.type), ['ul', 'ol']);
});

t('a price is not a list item', () => {
  // "RM1,200 a night" and a bare year must stay prose, or every cost line in
  // the chat turns into a numbered list of one.
  const b = parse('RM1,200 a night in September.\n2026 is busier than 2025.');
  assert.deepEqual(b.map((x) => x.type), ['p', 'p']);
});

console.log('\nBlocks — yes / maybe / no');

const NAMES = ['Cooking class', 'Night market', 'Waterfall', 'Elephant sanctuary'];

t('all three verdicts come back in one message', () => {
  const msg = triageMessage(NAMES, {
    'Cooking class': 'yes', 'Night market': 'yes',
    'Waterfall': 'maybe', 'Elephant sanctuary': 'no',
  });
  assert.equal(msg, 'Yes to Cooking class and Night market. Maybe Waterfall. Not Elephant sanctuary.');
});

t('a no travels on its own — the old tick could not say this at all', () => {
  assert.equal(triageMessage(NAMES, { 'Waterfall': 'no' }), 'Not Waterfall.');
});

t('card order wins over tap order', () => {
  const msg = triageMessage(NAMES, { 'Waterfall': 'yes', 'Cooking class': 'yes' });
  assert.equal(msg, 'Yes to Cooking class and Waterfall.');
});

t('unanswered cards are left out, not counted as no', () => {
  const msg = triageMessage(NAMES, { 'Cooking class': 'yes' });
  assert.equal(msg, 'Yes to Cooking class.');
  assert.ok(!msg.includes('Not'));
});

t('nothing answered sends nothing', () => {
  assert.equal(triageMessage(NAMES, {}), '');
  assert.equal(triageMessage(NAMES, { 'Waterfall': null }), '');
});

t('three of one kind read as a sentence', () => {
  const msg = triageMessage(NAMES, {
    'Cooking class': 'yes', 'Night market': 'yes', 'Waterfall': 'yes',
  });
  assert.equal(msg, 'Yes to Cooking class, Night market and Waterfall.');
});

console.log('\nProgress — stages are facts about the itinerary');

// The stage table is data, so it is re-declared here rather than imported out
// of a component that pulls in React and styled-jsx.
const half = { trip: { title: 'Chiang Mai' }, days: [{ items: [] }], stays: [], photos: {} };
const done = {
  trip: { title: 'Chiang Mai' },
  days: [{ items: [{ t: 'Breakfast' }] }],
  stays: [{ n: 'Villa', lat: 18.7, lon: 98.9 }],
  photos: { a: 'https://x/1.jpg' },
};

const stage = {
  shape: (it) => !!(it && it.trip && it.trip.title),
  days: (it) => ((it && it.days) || []).length > 0,
  stays: (it) => ((it && it.stays) || []).length > 0,
  items: (it) => ((it && it.days) || []).some((d) => ((d && d.items) || []).length > 0),
  photos: (it) => Object.keys((it && it.photos) || {}).length > 0,
  map: (it) => ((it && it.stays) || []).some((s) => isFinite(+s.lat) && isFinite(+s.lon)),
};

t('nothing built yet ticks nothing, and does not throw on null', () => {
  assert.equal(Object.values(stage).filter((f) => f(null)).length, 0);
});

t('a half-written trip ticks exactly what exists', () => {
  assert.ok(stage.shape(half) && stage.days(half));
  assert.ok(!stage.stays(half) && !stage.items(half) && !stage.photos(half) && !stage.map(half));
});

t('a finished trip ticks all six', () => {
  assert.equal(Object.values(stage).filter((f) => f(done)).length, 6);
});

t('a stay with no coordinates does not tick the map', () => {
  assert.ok(!stage.map({ stays: [{ n: 'Villa' }] }));
});

console.log('\n' + n + ' passed\n');
