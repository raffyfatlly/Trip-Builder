// A build that has stopped must stop saying it is building.
//
// raffy, 2026-09-08: "the build never finish now. it ticks everything but the
// progress bar never finish and there's no more done button."
//
// One unanswered tool call used to hold the whole app in "building" for ever,
// with a finished trip sitting behind it. The call that caused his was a
// find_photos in a shape that threw (see test-photoshape.mjs) — but the shape
// of the failure is the part worth a guard: no single tool call should be able
// to keep a completed trip out of reach. Four minutes of total silence from the
// builder means it has stopped, whether it finished, wedged or died, and in all
// three cases the honest thing to show is the trip.
//
//   node setup/test-buildend.mjs
import { _goneQuiet as goneQuiet } from '../lib/managedAgents.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };
const ago = (ms) => new Date(Date.now() - ms).toISOString();

console.log('');
ok('a builder that just did something is working',
   goneQuiet([{ type: 'agent.custom_tool_use', created_at: ago(3000) }]) === false);
ok('and one mid-step, a minute in, still is',
   goneQuiet([{ type: 'agent.custom_tool_use', created_at: ago(60000) }]) === false);
ok('three minutes of silence is still given the benefit of the doubt',
   goneQuiet([{ type: 'agent.custom_tool_use', created_at: ago(180000) }]) === false);
ok('but five minutes of nothing is a build that has stopped',
   goneQuiet([{ type: 'agent.custom_tool_use', created_at: ago(300000) }]) === true);

// It reads the LAST event that carries a time, not the last event: some event
// shapes have no timestamp at all and they must not hide a recent one.
ok('an untimed event does not mask the real last one',
   goneQuiet([
     { type: 'agent.custom_tool_use', created_at: ago(2000) },
     { type: 'session.status_idle' },
   ]) === false);
ok('and the older field name is read too',
   goneQuiet([{ type: 'agent.message', timestamp: ago(300000) }]) === true);

// No timestamps anywhere is an older session shape. Say it is moving rather
// than declaring somebody's build over on no evidence at all.
ok('no times at all is not treated as stopped',
   goneQuiet([{ type: 'agent.message' }, { type: 'session.status_running' }]) === false);
ok('and neither is an empty log', goneQuiet([]) === false);

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
