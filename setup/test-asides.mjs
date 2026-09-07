// A shared chat has to read like a chat.
//
// raffy, 2026-09-07, with two screenshots: "its weird to see the chats. i said
// something to syahirah. it got quoted. but I still have the original text
// accumulating at the bottom."
//
// Three separate bugs made that one picture:
//
//   1. Every message he sent to the agent went in as "raffy.fatlly: <text>",
//      so the browser's optimistic bubble — cleared when the same words come
//      back from the server — never matched, and stayed on screen forever
//      beside the server's copy. The @ being stripped and attachments adding a
//      📎 line did the same thing for the same reason.
//   2. Held messages (said to each other, not to the agent) were appended after
//      the entire transcript, so a remark from three turns ago sat under an
//      answer given since.
//   3. Handing them to the agent DELETED them, so the moment somebody typed @
//      the side-conversation disappeared off the screen altogether.
//
// These are the tests for all three.
import assert from 'node:assert';
import { joinHeld, heldFor } from '../lib/listen.js';
import { fromBlock, whoIn, CTX_MARKER } from '../lib/context.js';
import { eventsToTranscript } from '../lib/managedAgents.js';

let n = 0;
const t = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };

const msg = (id, role, text, extra = []) => ({
  id, type: role === 'user' ? 'user.message' : 'agent.message',
  content: [...extra, { type: 'text', text }],
});

console.log('\nThe speaker travels beside the message, not inside it');
{
  t('a message the agent answers is exactly what they typed', () => {
    const events = [msg('e1', 'user', 'find me a hotel', [{ type: 'text', text: fromBlock('raffy.fatlly@gmail.com') }])];
    const [row] = eventsToTranscript(events);
    assert.equal(row.text, 'find me a hotel', 'the name must not be in the text');
  });
  t('but the app still knows who said it', () => {
    const events = [msg('e1', 'user', 'find me a hotel', [{ type: 'text', text: fromBlock('syahirah@x.com') }])];
    assert.equal(eventsToTranscript(events)[0].who, 'syahirah@x.com');
  });
  t('and the block itself never reaches the screen', () => {
    assert.ok(fromBlock('a@b.com').startsWith(CTX_MARKER), 'must be marked or it draws as a bubble');
  });
  t('a solo trip carries no speaker at all', () => {
    assert.equal(eventsToTranscript([msg('e1', 'user', 'hello')])[0].who, undefined);
  });
  t('whoIn ignores messages that have no from block', () => {
    assert.equal(whoIn([{ type: 'text', text: 'just words' }]), '');
    assert.equal(whoIn(null), '');
  });
}

console.log('\nAsides go back where they were said');
{
  const transcript = [
    { role: 'user', text: 'hi', id: 'e1' },
    { role: 'assistant', text: 'hello', id: 'e2' },
    { role: 'assistant', text: 'and here it is', id: 'e5' },
  ];
  t('an aside sits under the message it followed', () => {
    const out = joinHeld(transcript, [{ who: 'a@x', text: 'what do you think', at: 7, after: 'e2' }]);
    assert.deepEqual(out.map((r) => r.id), ['e1', 'e2', 'held:7', 'e5']);
  });
  t('and is marked as an aside, with a name on it', () => {
    const [, , held] = joinHeld(transcript, [{ who: 'a@x', text: 'hmm ok', at: 7, after: 'e2' }]);
    assert.equal(held.aside, true);
    assert.equal(held.who, 'a@x');
    assert.equal(held.role, 'user');
  });
  t('the ready card stays attached to its own message', () => {
    const withCard = [...transcript, { role: 'ready', id: 'e5:ready' }];
    const out = joinHeld(withCard, [{ who: 'a@x', text: 'nice', at: 8, after: 'e5' }]);
    assert.deepEqual(out.map((r) => r.id), ['e1', 'e2', 'e5', 'e5:ready', 'held:8']);
  });
  t('several asides in one gap keep their order', () => {
    const out = joinHeld(transcript, [
      { who: 'a@x', text: 'one', at: 1, after: 'e2' },
      { who: 'b@x', text: 'two', at: 2, after: 'e2' },
    ]);
    assert.deepEqual(out.map((r) => r.id), ['e1', 'e2', 'held:1', 'held:2', 'e5']);
  });
  t('an aside with no anchor still shows, at the end', () => {
    const out = joinHeld(transcript, [{ who: 'a@x', text: 'orphan', at: 3, after: 'gone' }]);
    assert.equal(out[out.length - 1].text, 'orphan');
  });
  t('an empty one is dropped rather than drawn blank', () => {
    assert.equal(joinHeld(transcript, [{ who: 'a@x', text: '   ', at: 4 }]).length, transcript.length);
  });
  t('nothing held changes nothing', () => {
    assert.deepEqual(joinHeld(transcript, []), transcript);
  });
}

console.log('\nHanded to the agent once, shown to them always');
{
  // What send.js does: only the unmarked ones go into the context block, and
  // the mark is what stops them going twice. Both halves matter — the first
  // stops it re-reading a conversation it has already had, the second is why
  // the messages survive on screen.
  const held = [
    { who: 'a@x', text: 'the museum looked good', at: 1, sent: true },
    { who: 'b@x', text: 'lets do tuesday instead', at: 9, sent: false },
  ];
  t('only what it has not already been given', () => {
    const block = heldFor(held.filter((m) => !m.sent));
    assert.ok(block.includes('lets do tuesday instead'), block);
    assert.ok(!block.includes('the museum looked good'), 'handed over twice');
  });
  t('but everything is still there to display', () => {
    assert.equal(joinHeld([{ role: 'assistant', text: 'ok', id: 'e1' }], held).length, 3);
  });
}

console.log('\nThe optimistic bubble clears itself');
{
  // The exact comparison from pages/index.js. Kept in step by hand, which is
  // not ideal — but the alternative is importing a page component into a test
  // runner, and this is the logic that actually broke.
  const flat = (x) => String(x || '').replace(/\s+/g, ' ').trim();
  const bare = (x) => flat(x).replace(/^@\S*\s*/, '');
  const cleared = (bubble, transcript) => {
    const landed = transcript.map(flat);
    const a = flat(bubble.sent != null ? bubble.sent : bubble.text);
    const b = bare(bubble.sent != null ? bubble.sent : bubble.text);
    return landed.some((l) => l === a || l === b
      || (a && l.endsWith(': ' + a)) || (b && l.endsWith(': ' + b)));
  };

  t('plain text, as it always did', () => {
    assert.ok(cleared({ text: 'find me a hotel' }, ['find me a hotel']));
  });
  t('an old row with the name glued on still settles', () => {
    assert.ok(cleared({ text: 'something new' }, ['raffy.fatlly: something new']),
      'this is the exact pile in his screenshot');
  });
  t('the @ coming off does not orphan the bubble', () => {
    assert.ok(cleared({ text: '@ find something else' }, ['find something else']));
    assert.ok(cleared({ text: '@trip trending' }, ['trending']));
  });
  t('an attachment line does not either', () => {
    assert.ok(cleared({ text: '📎 booking.pdf\nis this ok', sent: 'is this ok' }, ['is this ok']));
  });
  t('and a message that really has not landed is kept', () => {
    assert.ok(!cleared({ text: 'find me a hotel' }, ['something else entirely']));
  });
}

console.log('\n' + n + ' passed');
