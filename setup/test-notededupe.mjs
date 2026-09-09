// A dedupe key that is not in the data used to mean no dedupe at all.
//
// 2026-09-09: a diagnostic passed 'pump' as note()'s dedupe key while its data
// carried no `pump` field. The check read data[dedupe], found undefined, and
// skipped deduping entirely — so every pump appended a line. Four hundred of
// them went into the Melbourne journal before anybody looked.
//
// Passing a key always means "only one of these", so an absent key now falls
// back to one line per event rather than none.
//
//   node setup/test-notededupe.mjs
import { alreadyThere } from '../lib/journal.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

console.log('');

// The bug, exactly: dedupe on a field the data does not have.
const lines = [{ ev: 'build.looping', left: 6 }];
ok('a key missing from the data still collapses by event',
   alreadyThere(lines, 'build.looping', 'loop', { left: 4 }) === true);
ok('and a different event is untouched by that',
   alreadyThere(lines, 'build.done', 'loop', { left: 4 }) === false);

// The normal case: the key IS there, so it collapses by VALUE.
const builds = [{ ev: 'build.done', build: 'a' }];
ok('a key that is there dedupes by its value',
   alreadyThere(builds, 'build.done', 'build', { build: 'a' }) === true);
ok('and lets a different value through',
   alreadyThere(builds, 'build.done', 'build', { build: 'b' }) === false);

// No key at all: keep everything. A timeline is not a set.
ok('no dedupe argument collapses nothing',
   alreadyThere([{ ev: 'msg', text: 'one' }], 'msg', undefined, { text: 'two' }) === false);

// And the empty cases, which is where a helper like this usually breaks.
ok('an empty journal never looks like a duplicate',
   alreadyThere([], 'anything', 'k', { k: 1 }) === false);
ok('and neither does a missing one', alreadyThere(null, 'anything', 'k', { k: 1 }) === false);

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
