// What a build carries between its own steps.
//
// raffy, 2026-09-05: "it seems like its taking so long if it just filling json."
//
// It is not filling one JSON. It writes the whole trip in one save_itinerary
// call and then makes five to fifteen more model calls tweaking it, and every
// one of those re-sends the conversation — which the eight real builds in
// Firestore had grown to between 57 and 87 kB. Two of the eight ran out of
// steps before they finished.
//
// So the applied arguments are dropped and the model is handed an index
// instead. What is checked here is that the index is accurate, that it is the
// same index the edit tools take, and that dropping the arguments does not
// break the shape a chat-completions API requires.
//
//   node setup/test-buildsize.mjs

import fs from 'fs';
import { compact } from '../lib/orBuilder.js';
import { digest, resultFor, applyEdit } from '../lib/itinerary.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const TRIP = JSON.parse(fs.readFileSync('/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));

// --- the index ---------------------------------------------------------------
console.log('');
{
  const d = digest(TRIP);
  const dayLine = d.split('\n').find((l) => l.startsWith('days:')) || '';
  ok('every day is in the index, by number and title',
     TRIP.days.every((day, i) => dayLine.includes(i + ' ' + day.dow) &&
       dayLine.includes(String(day.title).slice(0, 18))),
     TRIP.days.length + ' days');
  ok('so is every stay', TRIP.stays.every((s) => d.includes((s.short || s.n).slice(0, 20))));
  ok('and every idea', TRIP.ideas.every((s) => d.includes(s.n.slice(0, 20))));
  ok('it says how many photos are on', /\d+ photos attached/.test(d), (/\d+ photos attached/.exec(d) || [])[0]);

  // The whole point is that it is small.
  const full = JSON.stringify(TRIP).length;
  ok('and it is a fraction of the itinerary', d.length < full / 20,
     Math.round(d.length / 1024 * 10) / 10 + 'kB index for ' + Math.round(full / 1024) + 'kB of trip');

  // The index is worthless if its numbers are not the numbers the tools take.
  const changed = applyEdit(TRIP, 'update_day', { index: 2, day: { ...TRIP.days[2], title: 'Rewritten' } });
  ok('its numbers are the ones update_day takes', changed.days[2].title === 'Rewritten');
  ok('and it does not disturb the day either side',
     changed.days[1].title === TRIP.days[1].title && changed.days[3].title === TRIP.days[3].title);
  ok('a result carries the index with it', resultFor('update_day', changed).includes('days:'));
  ok('and still says what happened',
     /Applied\. Now \d+ days/.test(resultFor('update_day', changed)));
  ok('an empty itinerary has no index', digest(null) === '');
}

// --- dropping the applied arguments ------------------------------------------
console.log('');
{
  const big = JSON.stringify({ trip: TRIP.trip, stays: TRIP.stays, days: TRIP.days, ideas: TRIP.ideas });
  const messages = [
    { role: 'system', content: 'you are the builder' },
    { role: 'user', content: 'the brief' },
    { role: 'assistant', content: '', tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'save_itinerary', arguments: big } }] },
    { role: 'tool', tool_call_id: 'c1', name: 'save_itinerary', content: 'Itinerary created.' },
    { role: 'assistant', content: '', tool_calls: [
      { id: 'c2', type: 'function', function: { name: 'find_photos', arguments: '{"queries":["Furama Resort Da Nang"]}' } }] },
    { role: 'tool', tool_call_id: 'c2', name: 'find_photos', content: 'one photo' },
  ];

  const before = JSON.stringify(messages).length;
  const after = JSON.stringify(compact(messages)).length;
  ok('the conversation shrinks by an order of magnitude', after < before / 10,
     Math.round(before / 1024) + 'kB -> ' + Math.round(after / 1024) + 'kB');

  const c = compact(messages);
  // A tool result has to have an assistant tool_call to answer to, so the call
  // itself must survive with its id and its name.
  ok('every call keeps its id', c[2].tool_calls[0].id === 'c1' && c[4].tool_calls[0].id === 'c2');
  ok('and its name', c[2].tool_calls[0].function.name === 'save_itinerary');
  ok('the arguments are gone but still valid JSON',
     typeof JSON.parse(c[2].tool_calls[0].function.arguments) === 'object');
  ok('a small call is left exactly as it was',
     c[4].tool_calls[0].function.arguments === messages[4].tool_calls[0].function.arguments);
  ok('the results are untouched', c[3].content === 'Itinerary created.');
  ok('and the brief is untouched, because it is the whole input',
     c[1].content === 'the brief');
  ok('the message order is unchanged', c.length === messages.length &&
     c.every((m, i) => m.role === messages[i].role));

  // Twice is the same as once: every step runs this over the whole history.
  ok('compacting again changes nothing',
     JSON.stringify(compact(c)) === JSON.stringify(c));
  ok('a conversation with no calls is returned as it was',
     JSON.stringify(compact([{ role: 'user', content: 'hi' }])) === '[{"role":"user","content":"hi"}]');
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
