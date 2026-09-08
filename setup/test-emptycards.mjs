// "Here they are" over an empty screen.
//
//   node setup/test-emptycards.mjs
//
// raffy, 2026-09-08, with a screenshot of the agent writing "here's what's
// actually getting attention right now, plus some serious food:" above nothing
// at all, and him replying "Where? I don't see it": "sometimes this happen.
// find out why."
//
// Two faults, and the second is the one that mattered.
//
// The card set has three separate lists — options in `items`, spots in `spots`,
// facts in `facts` — and `kind` decides which one the renderer draws. Name one
// and fill another and it looks in an empty array. That is recoverable: the
// row shape is what really decides how it should be drawn, so the filled list
// now wins over the named kind.
//
// The real fault: `present` replied "Shown to the traveller" whatever was in
// it, INCLUDING NOTHING. So an empty call was reported as a success and the
// agent wrote its message on that basis. The traveller then does the debugging.

import assert from 'node:assert';
import { blockFrom } from '../lib/blocks.js';

let n = 0;
const t = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };
const call = (input) => ({ id: 'e1', name: 'present', input });

console.log('\nThe filled list wins over the named kind');
{
  t('a normal options set is drawn as options', () => {
    assert.equal(blockFrom(call({ kind: 'options', title: 'Hotels', items: [{ name: 'A' }] })).kind, 'options');
  });
  t('spots filled but called options is drawn as SPOTS', () => {
    // Otherwise the renderer reads `items`, finds nothing, and draws a heading
    // over an empty space — which is the screenshot.
    const b = blockFrom(call({ kind: 'options', title: 'Viral', spots: [{ name: 'Kwai Chai Hong' }] }));
    assert.equal(b.kind, 'spots');
    assert.equal(b.spots.length, 1);
  });
  t('facts filled but called options is drawn as facts', () => {
    assert.equal(blockFrom(call({ kind: 'options', title: 'Costs', facts: [{ label: 'Taxi', value: 'RM30' }] })).kind, 'facts');
  });
}

console.log('\nAn empty call draws nothing at all');
{
  t('every list empty means no block', () => {
    assert.equal(blockFrom(call({ kind: 'spots', title: 'Viral spots', intro: 'Here they are', spots: [] })), null);
  });
  t('and a title and an intro alone are not a card set', () => {
    assert.equal(blockFrom(call({ kind: 'options', title: 'Hotels', intro: 'Three good ones' })), null);
  });
  t('a proposal is different — it has no list to be empty', () => {
    assert.ok(blockFrom({ id: 'e2', name: 'propose_trip', input: { destination: 'Penang' } }));
  });
}

// What pumpChat answers the agent with. Kept in step with lib/managedAgents.js
// by using the same function it uses to decide.
console.log('\nAnd the agent is TOLD, so it can fix it in the same turn');
{
  const answer = (input) => (blockFrom(call(input))
    ? 'Shown to the traveller. Keep your message short — do not repeat the cards in prose.'
    : 'NOT SHOWN — that call had no cards in it, so their screen is unchanged.');

  t('a full set is confirmed', () => {
    assert.match(answer({ kind: 'spots', spots: [{ name: 'A' }] }), /^Shown to the traveller/);
  });
  t('an empty one is refused, in as many words', () => {
    assert.match(answer({ kind: 'spots', spots: [] }), /^NOT SHOWN/);
  });
  t('the refusal says their screen is unchanged, not that it failed', () => {
    // "Failed" invites an apology to the traveller. "Their screen is unchanged"
    // tells the agent what to DO, which is the only useful thing here.
    assert.match(answer({ kind: 'options', items: [] }), /screen is unchanged/);
  });
}

console.log('\n' + n + ' passed');
