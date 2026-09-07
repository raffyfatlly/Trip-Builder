// The agent must be running the tools this repo thinks it has.
//
// raffy, 2026-09-07: "what command is that? are you asking me to do work?"
//
// Tools live on the persisted Managed Agent, not in the deploy, so shipping a
// new tool did nothing until somebody ran a script by hand — and the failure
// was silent: the agent kept the old list and simply could not reach the new
// thing. The deployment now pushes it itself before creating a session. These
// check the two ways that can still go wrong quietly.
import assert from 'node:assert';
import { CHAT_TOOLS, modelFor } from '../lib/agentSync.js';
import { EDIT_TOOL } from '../lib/editTools.js';
import { toEdits } from '../lib/editTools.js';

let n = 0;
const t = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };

console.log('\nThe list the agent gets');
{
  const tools = CHAT_TOOLS();
  const names = tools.filter((x) => x.name).map((x) => x.name);

  t('every tool the app answers is in the list it sends', () => {
    // These are the names pumpChat has handlers for. A tool answered but never
    // sent is a tool the agent can never call.
    for (const need of ['read_itinerary', 'edit_itinerary', 'build_itinerary',
      'check_prices', 'research', 'note_plan']) {
      assert.ok(names.includes(need), need + ' is answered but not sent');
    }
  });
  t('the container toolset is off', () => {
    const set = tools.find((x) => x.type === 'agent_toolset_20260401');
    assert.ok(set, 'the toolset entry has to be present to be switched off');
    assert.equal(set.default_config.enabled, false);
  });
  t('nothing is in the list twice', () => {
    assert.equal(new Set(names).size, names.length, names.join(', '));
  });
}

console.log('\nEvery op the agent is offered actually does something');
{
  // The enum is what the model reads. An op advertised there with no branch in
  // toEdits is worse than a missing op: the model calls it, the app reports
  // "applied", and nothing changes.
  const ops = EDIT_TOOL.input_schema.properties.ops.items.properties.op.enum;
  const IT = {
    trip: { title: 'X', start: '2026-11-12', end: '2026-11-13' },
    stays: [{ n: 'A', dates: '12 Nov' }],
    days: [
      { dow: 'THU', dom: 12, stay: 0, title: 'a', items: [{ _id: 'b0-0', h: 'Thing' }] },
      { dow: 'FRI', dom: 13, stay: 0, title: 'b', items: [] },
    ],
  };
  // One well-formed call per op, so "produces no edits" means the branch is
  // missing rather than the input being wrong.
  const sample = {
    update: { op: 'update', day: 0, id: 'b0-0', patch: { h: 'Other' } },
    delete: { op: 'delete', day: 0, id: 'b0-0' },
    add: { op: 'add', day: 0, item: { t: '09:00', h: 'New stop' } },
    add_day: { op: 'add_day', at: 1, newDay: { title: 'Extra', stay: 0 } },
    remove_day: { op: 'remove_day', at: 1 },
    shift_dates: { op: 'shift_dates', newStart: '2026-11-19' },
    update_trip: { op: 'update_trip', tripPatch: { title: 'Y' } },
    update_stay: { op: 'update_stay', stay: 0, stayPatch: { n: 'B' } },
    confirm_stay: { op: 'confirm_stay', stay: 0 },
    save_booking: { op: 'save_booking', booking: { kind: 'stay', title: 'A' } },
    add_task: { op: 'add_task', task: { what: 'Buy an eSIM' } },
    tick_task: { op: 'tick_task', id: 'd:stay0' },
    drop_task: { op: 'drop_task', id: 'd:flights' },
  };

  t('the enum and the samples cover each other', () => {
    assert.deepEqual([...ops].sort(), Object.keys(sample).sort());
  });
  for (const op of ops) {
    t('  ' + op + ' produces at least one edit', () => {
      const out = toEdits([sample[op]], 1, IT);
      assert.ok(out.length > 0, op + ' is advertised but does nothing');
    });
  }
}

console.log('\nThe model object, which is where a 400 comes from');
{
  // raffy, 2026-09-07: "change sonnet to haiku." The agent had been running
  // effort: medium since it was on Sonnet, and Haiku 4.5 REJECTS effort — so
  // moving the model without dropping the field would have 400'd every
  // conversation, and it would have looked like the model being bad rather
  // than the request being malformed.
  t('haiku gets no effort at all', () => {
    const m = modelFor({ id: 'claude-sonnet-5', effort: { type: 'medium' } }, 'claude-haiku-4-5');
    assert.equal(m.id, 'claude-haiku-4-5');
    assert.ok(!('effort' in m), JSON.stringify(m));
  });
  t('switching back to sonnet gets it again', () => {
    const m = modelFor({ id: 'claude-haiku-4-5' }, 'claude-sonnet-5');
    assert.equal(m.effort.type, 'medium');
  });
  t('an effort already set is left alone', () => {
    assert.equal(modelFor({ effort: { type: 'high' } }, 'claude-opus-5').effort.type, 'high');
  });
  t('anything else on the live model survives the swap', () => {
    const m = modelFor({ id: 'claude-sonnet-5', inference_geo: 'us' }, 'claude-haiku-4-5');
    assert.equal(m.inference_geo, 'us');
  });
  // An id we do not recognise errs toward omitting effort, because sending it
  // where it is unsupported is a hard 400 while omitting it is only a default.
  t('an unknown model is treated as not taking effort', () => {
    assert.ok(!('effort' in modelFor({ effort: { type: 'medium' } }, 'something-new')));
  });
  t('no date suffix on the id we ship', () => {
    assert.equal(modelFor({}, 'claude-haiku-4-5').id, 'claude-haiku-4-5');
  });
}

console.log('\n' + n + ' passed');
