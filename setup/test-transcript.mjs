// Where the "your itinerary is ready" card sits in the conversation.
//
// raffy, 2026-09-02: "the open app file button should stay at the location
// where its given and not persisting to be at the bottom of chat everytime."
//
// It used to be rendered after the message list, so however much was said
// afterwards it re-pinned itself to the bottom — a notification wearing the
// conversation's clothes. The position is decided here now, in the transcript,
// at the moment the build was started.
//
//   node setup/test-transcript.mjs

import { eventsToTranscript } from '../lib/managedAgents.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const msg = (type, id, text) => ({ type, id, content: [{ type: 'text', text }] });
const roles = (t) => t.map((r) => r.role).join(' ');

{
  const t = eventsToTranscript([
    msg('user.message', 'u1', 'build it'),
    { type: 'agent.custom_tool_use', id: 'c1', name: 'build_itinerary', input: {} },
    msg('agent.message', 'a1', 'Building it now.'),
    msg('user.message', 'u2', 'can we add a beach day'),
    msg('agent.message', 'a2', 'Added it to the Thursday.'),
  ]);
  ok('the card lands where the build was started', roles(t) === 'user assistant ready user assistant', roles(t));
  ok('after the agent said it was building, not before',
     t.findIndex((r) => r.role === 'ready') === 2);
  ok('and the rest of the conversation is below it',
     t.length - 1 > t.findIndex((r) => r.role === 'ready'));
  ok('it carries an id, so React can key it', !!t.find((r) => r.role === 'ready').id);
}

{
  // A rebuild is another moment, not a replacement for the first.
  const t = eventsToTranscript([
    msg('user.message', 'u1', 'build it'),
    { type: 'agent.custom_tool_use', id: 'c1', name: 'build_itinerary', input: {} },
    msg('agent.message', 'a1', 'Building it now.'),
    msg('user.message', 'u2', 'change the dates'),
    { type: 'agent.custom_tool_use', id: 'c2', name: 'build_itinerary', input: {} },
    msg('agent.message', 'a2', 'Rebuilding on the new dates.'),
  ]);
  ok('a rebuild gets its own card', t.filter((r) => r.role === 'ready').length === 2, roles(t));
  ok('and the ids differ', new Set(t.filter((r) => r.role === 'ready').map((r) => r.id)).size === 2);
}

{
  const t = eventsToTranscript([
    msg('user.message', 'u1', 'build it'),
    { type: 'agent.custom_tool_use', id: 'c1', name: 'build_itinerary', input: {} },
  ]);
  ok('a build with nothing said after it still gets one',
     t.filter((r) => r.role === 'ready').length === 1, roles(t));
}

{
  const t = eventsToTranscript([
    msg('user.message', 'u1', 'hello'),
    msg('agent.message', 'a1', 'Where are you going?'),
  ]);
  ok('a conversation with no build has no card', !t.some((r) => r.role === 'ready'), roles(t));
}


// --- the tools that used to work invisibly ------------------------------------
//
// raffy, 2026-09-07: "ya it just give me text response. no structured response
// like before." I blamed the model. A live probe then spent 32 seconds, came
// back having read three booking sites, and still reported no actions — because
// actionOf() had no case for check_prices, place_details, travel_time or
// trip_facts. The turn went quiet for half a minute and produced prose with
// nothing on screen saying it had gone and looked.

console.log('\nevery tool the agent has says what it did');
{
  const t = eventsToTranscript([
    msg('user.message', 'u1', 'what does the Sheraton cost'),
    { type: 'agent.custom_tool_use', id: 'c1', name: 'check_prices',
      input: { hotels: [{ hotel: 'Sheraton', city: 'Kuching', checkIn: '2026-10-14', checkOut: '2026-10-17' }] } },
    msg('agent.message', 'a1', 'Booking showed nothing; Agoda had it at RM320.'),
  ]);
  const a = (t.find((r) => r.role === 'assistant') || {}).actions || [];
  ok('a price lookup is visible work', a.length === 1, JSON.stringify(a));
  ok('and it says what was looked up', /Checked live prices/.test(a[0] && a[0].text), (a[0] || {}).text);
  ok('naming the hotel in the detail', /Sheraton, Kuching/.test((a[0] || {}).detail || ''), (a[0] || {}).detail);
}

{
  const t = eventsToTranscript([
    msg('user.message', 'u1', 'is it open on a Tuesday'),
    { type: 'agent.custom_tool_use', id: 'c1', name: 'place_details',
      input: { places: [{ name: 'Madame Lan' }, { name: 'Han Market' }] } },
    { type: 'agent.custom_tool_use', id: 'c2', name: 'travel_time', input: {} },
    { type: 'agent.custom_tool_use', id: 'c3', name: 'trip_facts', input: {} },
    msg('agent.message', 'a1', 'Shut on Tuesdays.'),
  ]);
  const a = (t.find((r) => r.role === 'assistant') || {}).actions || [];
  ok('three more that were silent are visible', a.length === 3, JSON.stringify(a.map((x) => x.text)));
  ok('and the place lookup counts them', /Looked up 2 places/.test(a[0].text), a[0].text);
}

{
  // Cards stay excluded — they appear as themselves, and a pill underneath the
  // options saying "showed you options" is noise.
  const t = eventsToTranscript([
    msg('user.message', 'u1', 'suggest hotels'),
    { type: 'agent.custom_tool_use', id: 'c1', name: 'check_prices', input: { hotels: [{ city: 'Jakarta' }] } },
    msg('agent.message', 'a1', 'Here are three.'),
  ]);
  const a = (t.find((r) => r.role === 'assistant') || {}).actions || [];
  ok('a hotel-only lookup still reads right', /1 hotel\b/.test(a[0].text), a[0].text);
}

console.log(fail ? '\n' + fail + ' failed' : '\nall passed');
process.exit(fail ? 1 : 0);
