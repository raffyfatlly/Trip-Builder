// The agent speaks when it is asked to, and not otherwise.
//
// raffy, 2026-09-07, after testing it with Syahirah: "syahirah said hi, I said
// hi, then when one of us ask a question, it send this. that's a bit weird.
// create a mechanism that's not too complicated. maybe we can @ something to
// ask agent to reply or something? but make it easy for user to invoke."
//
// The first version guessed — free rules at both ends, a cheap model for the
// middle. Accurate enough on paper, wrong in use: you could not tell before
// pressing send whether it was going to answer, and two people cannot talk
// freely if a third might join at any moment. So it is one rule now, and these
// tests are mostly about what must NOT wake it.
import assert from 'node:assert';
import { shouldReply, asksAgent, withoutAsk, heldFor } from '../lib/listen.js';

let n = 0;
const t = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };

console.log('\nA trip with one person in it is untouched');
{
  // Almost every session. No @ required, every message answered, exactly as
  // before any of this existed.
  for (const m of ['hi', 'ok', 'what about tuesday', '@ anything']) {
    t(JSON.stringify(m) + ' is answered', () => {
      assert.deepEqual(shouldReply({ text: m, shared: false }), { reply: true, why: 'not shared' });
    });
  }
}

console.log('\nShared: it stays out unless asked');
{
  // This is the bug he hit: two people saying hi, then a question, and the
  // agent joining in.
  for (const m of ['hi', 'hi!', 'what about tuesday', 'you free tonight?',
    'add the zoo to day 3', 'find us a hotel']) {
    t(JSON.stringify(m) + ' does not wake it', () => {
      assert.equal(shouldReply({ text: m, shared: true }).reply, false);
    });
  }
  // "add the zoo to day 3" not waking it is a DELIBERATE loss. The old version
  // caught it; predictability is worth more than catching it.
}

console.log('\nShared: how they ask');
{
  t('a bare @', () => assert.equal(shouldReply({ text: '@ what about tuesday', shared: true }).reply, true));
  t('@ with a name', () => assert.equal(shouldReply({ text: '@trip find a hotel', shared: true }).reply, true));
  t('@ anywhere in the message', () => assert.equal(shouldReply({ text: 'ok so @ what next', shared: true }).reply, true));
  t('the composer button says so outright', () => {
    const out = shouldReply({ text: 'find a hotel', shared: true, asked: true });
    assert.equal(out.reply, true);
    assert.equal(out.why, 'asked');
  });
  t('asksAgent matches what shouldReply does', () => {
    assert.equal(asksAgent('@ hi'), true);
    assert.equal(asksAgent('hi'), false);
  });
}

console.log('\nThe @ is the summons, not the question');
{
  // Left in, replies tend to open by acknowledging being addressed.
  t('a bare @ prefix comes off', () => assert.equal(withoutAsk('@ what about tuesday'), 'what about tuesday'));
  t('so does @name', () => assert.equal(withoutAsk('@trip find a hotel'), 'find a hotel'));
  t('a message that is only @ keeps something to answer', () => {
    assert.ok(withoutAsk('@').length > 0);
  });
  t('an @ mid-sentence is left alone — it is probably an email', () => {
    assert.equal(withoutAsk('file this: booking@airasia.com'), 'file this: booking@airasia.com');
  });
}

console.log('\nWhat it is handed when it is asked');
{
  // Where "that's a bit weird" came from: it got "hi / hi" as the context for
  // a question about hotels.
  t('greetings and reactions are dropped', () => {
    assert.equal(heldFor([{ who: 'a@x', text: 'hi' }, { who: 'b@x', text: 'hi' },
      { who: 'a@x', text: 'ok' }, { who: 'b@x', text: '👍' }], 'a@x'), '');
  });
  t('substance is kept, attributed', () => {
    const b = heldFor([{ who: 'a@x', text: 'hi' },
      { who: 'b@x', text: 'i want a lie-in on the saturday' }], 'a@x');
    assert.ok(b.includes('lie-in'));
    assert.ok(b.includes('b'), b);
    assert.ok(!b.includes('hi\n'), b);
  });
  t('and told to answer only the newest message', () => {
    const b = heldFor([{ who: 'b@x', text: 'the museum looked good' }], 'a@x');
    assert.match(b, /Only the newest message is addressed to you/);
    assert.match(b, /Do not reply to the lines above/);
  });
  t('nothing held means nothing added', () => assert.equal(heldFor([], 'a@x'), ''));
}

console.log('\nIt cannot cost anything or be slow');
{
  t('the decision is synchronous', () => {
    const out = shouldReply({ text: 'hi', shared: true });
    assert.ok(!(out instanceof Promise), 'a decision that awaits can fail or stall');
    assert.equal(typeof out.reply, 'boolean');
  });
}

console.log('\n' + n + ' passed');
