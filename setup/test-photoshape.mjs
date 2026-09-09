// The shapes the builder actually sends, and the stall they caused.
//
// raffy, 2026-09-08: "the build never finish now. it ticks everything but the
// progress bar never finish and there's no more done button" and "the app
// didn't get the full image. some image missing."
//
// One cause, both symptoms. His Penang build sent find_photos like this, twice:
//
//   {"queries": "[\"Shangri-La Golden Sands Penang\", \"Clan Jetties Penang\"]"}
//
// A STRING holding a JSON array of BARE STRINGS, where the schema asks for an
// array of objects. `.slice(0, 8)` on a string returns its first eight
// CHARACTERS, so the app went and looked up `[`, `"`, `S`, `h`. Those junk
// lookups hung the request; a request that dies before it answers leaves the
// call pending for ever; and `building` was true for as long as anything was
// pending. Twelve places lost their photographs and the Done button never came.
//
//   node setup/test-photoshape.mjs
import { findPhotos } from '../lib/photos.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

// No Places key in this environment, so every lookup honestly finds nothing.
// That is the right test: what matters is WHAT IT ASKED FOR, which the answer
// echoes back line by line, and that it answers at all.
console.log('\nthe shape his build really sent');
{
  const sent = JSON.stringify(['Shangri-La Golden Sands Penang', 'Clan Jetties Penang', 'Nazlina Spice Station Penang']);
  const out = await findPhotos(sent);
  ok('a stringified array is read as its places, not its characters',
     /Shangri/.test(out) && /Clan Jetties/.test(out), out.split('\n')[1] || out.slice(0, 60));
  ok('and not as eight single characters', !/\n\s*\[\s*$/m.test(out) && !out.includes('undefined'),
     out.slice(0, 80).replace(/\n/g, ' | '));
  const asked = (out.match(/searched:/g) || []).length;
  ok('one lookup per place', asked === 3, asked + ' lookups');
}

console.log('\nthe other shapes it sends');
{
  const bare = await findPhotos(['Batu Ferringhi beach Penang']);
  ok('an array of plain strings works', /Batu Ferringhi/.test(bare));

  const proper = await findPhotos([{ key: 'jetty', search: 'Clan Jetties Penang' }]);
  ok('and so does the shape the schema asks for', /jetty/.test(proper));

  const one = await findPhotos('Penang Hill');
  ok('a single plain string is one search, not eleven letters',
     /Penang Hill/.test(one) && (one.match(/searched:/g) || []).length === 1);

  ok('nothing at all still says so', /No queries given/.test(await findPhotos([])));
  ok('and so does junk', /No queries given/.test(await findPhotos([null, '', {}])));
}

// The thing that actually hung: a lookup that never returns. findPhotos must
// come back regardless, because the alternative is the call staying pending
// and the build never ending.
console.log('\nit always answers');
{
  const t0 = Date.now();
  const out = await findPhotos(Array.from({ length: 8 }, (_, i) => 'somewhere ' + i));
  ok('eight lookups still return something', typeof out === 'string' && out.length > 0);
  ok('and well inside a request', Date.now() - t0 < 40000, (Date.now() - t0) + 'ms');
}

// A builder that gets no answer asks again, so the same call arrives more than
// once. raffy's Dolomites build was holding six find_photos calls, three of
// them identical — which would have been three rounds of the same eight Google
// lookups the moment the pump started working.
console.log('\nthe same call is not paid for twice');
{
  const { _dedupeKey } = await import('../lib/managedAgents.js');
  const a = { id: 'c1', name: 'find_photos', input: { queries: '["Tre Cime di Lavaredo"]' } };
  const b = { id: 'c2', name: 'find_photos', input: { queries: '["Tre Cime di Lavaredo"]' } };
  const c = { id: 'c3', name: 'find_photos', input: { queries: '["Bolzano old town"]' } };
  ok('two identical photo calls collapse to one', _dedupeKey(a) === _dedupeKey(b));
  ok('and a different one does not', _dedupeKey(a) !== _dedupeKey(c));
  // An edit op describes the itinerary AS IT STOOD at that call, so two of them
  // are not interchangeable even when the input matches.
  const e1 = { id: 'e1', name: 'update_day', input: { day: 0 } };
  const e2 = { id: 'e2', name: 'update_day', input: { day: 0 } };
  ok('edit calls are never collapsed', _dedupeKey(e1) !== _dedupeKey(e2));
}

// AND IT HAS TO STOP. raffy's Dolomites build put 1,776 requests to
// staticflickr.com through one session: six find_photos calls, eight places
// each, every candidate fetched to prove it loads — all inside one request that
// then died before it could send a single answer, so the next poll did it all
// again. The pump has a deadline now and answers what it cannot reach; this
// checks the half of it that lives here.
console.log('\nit cannot run away');
{
  const t0 = Date.now();
  // Sixteen places is twice what one call is allowed; it must still come back.
  const out = await findPhotos(Array.from({ length: 16 }, (_, i) => 'nowhere ' + i));
  ok('more than it accepts is capped, not attempted', (out.match(/searched:/g) || []).length <= 8,
     (out.match(/searched:/g) || []).length + ' lookups');
  ok('and it returns quickly enough to be answered', Date.now() - t0 < 40000,
     (Date.now() - t0) + 'ms');
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
