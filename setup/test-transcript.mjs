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

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
