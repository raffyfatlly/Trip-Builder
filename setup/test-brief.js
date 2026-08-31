// The handover. The builder no longer researches, so everything the chat found
// has to survive the trip through the brief — offline, no API cost.

import { briefToText } from '../lib/build.js';
import { BUILD_TOOL } from '../lib/brief.js';
import { BUILDER_SYSTEM } from '../lib/builderPrompt.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const P = BUILD_TOOL.input_schema.properties;
ok('research is a field', !!P.research);
ok('and it is required — a brief without it is a build that searches again',
   BUILD_TOOL.input_schema.required.includes('research'));
ok('the accepted day outline travels too', !!P.shape);
ok('and what could not be found', !!P.gaps);

const text = briefToText({
  destination: 'Da Nang, Vietnam',
  start: '2026-09-10', end: '2026-09-14',
  travellers: [{ name: 'Aisyah' }, { name: 'Adam', age: '6' }],
  stays: [{ name: 'Furama Resort', dates: 'all 4 nights', confirmed: true }],
  flights: 'AK1498 KUL-DAD 06:55',
  budget: 'RM400/night',
  considerations: 'Adam is six and will flag by 4pm.',
  shape: [
    { label: 'Thu 10 Sep — arrive', plan: 'Land 09:15, bags at the resort, beach.' },
    { label: 'Fri 11 Sep', plan: 'Marble Mountains early, pool after.' },
  ],
  research: [
    { about: 'Ba Na Hills', found: '900,000 VND adult, cable car from 07:30, sells out weekends', source: 'official site' },
    { about: 'September weather', found: 'Start of the wet season; afternoon storms common, mornings usually clear', source: 'climate averages' },
  ],
  gaps: ['Furama check-in time'],
});

ok('the accepted days are marked as not up for redesign', text.includes('Do not restructure the trip'));
ok('every day they agreed to is carried', text.includes('Marble Mountains early'));
ok('research is labelled as already done', text.includes('DO NOT REPEAT IT'));
ok('the numbers survive', text.includes('900,000 VND') && text.includes('07:30'));
ok('so does where it came from', text.includes('official site'));
ok('seasonality survives — the thing general knowledge gets wrong', text.includes('afternoon storms'));
ok('gaps are named as the only search-worthy things', text.includes('the only things worth searching'));
ok('and the judgement still leads', text.indexOf('flag by 4pm') < text.indexOf('RESEARCH ALREADY DONE'));

// A thin brief must still produce something the builder can act on.
const thin = briefToText({
  destination: 'Bali', start: '2026-10-01', end: '2026-10-04',
  travellers: [{ name: 'Sam' }], stays: [{ name: 'somewhere in Ubud', confirmed: false }],
  considerations: 'They asked me to just build it.', research: [],
});
ok('a brief with no research still reads as a brief', thin.includes('Build the itinerary'));
ok('and does not fake sections it does not have', !thin.includes('RESEARCH ALREADY DONE'));
ok('an unconfirmed stay is still flagged', thin.includes('[NOT CONFIRMED]'));

ok('the builder is told the research is done', BUILDER_SYSTEM.includes('The research is already done'));
ok('and given a hard search budget', /three searches at most/.test(BUILDER_SYSTEM));
ok('it no longer opens by telling itself to search', !BUILDER_SYSTEM.includes('Search the web before you write a single day'));
ok('but it still may not invent', BUILDER_SYSTEM.includes('Never invent anything'));

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
