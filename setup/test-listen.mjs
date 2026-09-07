// The agent listens, and speaks when it is spoken to.
//
// raffy, 2026-09-07: "allow them to chat in the same session the two different
// user with each other but the agent can also know. but not like automated
// response. a smart response... if they just talking between each other the
// agent don't respond."
//
// The thing being protected here is money as much as tone. Chat is 78% of what
// this app spends and one turn is about $0.109, so waking the agent for "haha
// ok" is the most expensive possible way to say nothing. These check that the
// free rules catch the two ends of the distribution — because every message
// they do NOT catch costs a model call to decide.
import assert from 'node:assert';
import { quickCall, shouldReply, heldFor } from '../lib/listen.js';

let n = 0;
const t = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };

console.log('\nDecided for free: they are talking to each other');
{
  for (const m of ['ok', 'okay', 'yeah', 'sure', 'haha', 'lol', 'nice', 'perfect',
    'thanks', 'ya', 'nope', 'hmm', 'done', 'ok lah']) {
    t(JSON.stringify(m), () => assert.equal(quickCall(m), false));
  }
  t('a string of them is still chatter', () => {
    assert.equal(quickCall('haha ok'), false);
    assert.equal(quickCall('yeah sure nice'), false);
  });
  t('emoji only', () => {
    assert.equal(quickCall('👍'), false);
    assert.equal(quickCall('😂😂'), false);
  });
  t('nothing at all', () => assert.equal(quickCall(''), false));
}

console.log('\nDecided for free: that one is for the agent');
{
  t('addressed by name or @', () => {
    assert.equal(quickCall('@claude what about tuesday'), true);
    assert.equal(quickCall('hey assistant, any halal places?'), true);
  });
  t('told to do something the app does', () => {
    for (const m of ['Add universal studios to day 2', 'remove the tuesday dinner',
      'book it', 'can you check the price', 'find us a hotel near bugis',
      "let's do tuesday then", 'move it to 8pm']) {
      assert.equal(quickCall(m), true, m);
    }
  });
}

console.log('\nLeft to the judge — and only these');
{
  // Every one of these is a real question with two defensible answers, which
  // is exactly what a model is for. Anything decidable by a regex must NOT
  // reach here, because reaching here costs money.
  for (const m of ['what time does the museum open?', 'you free tonight?',
    'i think we should eat there', 'is that too far']) {
    t(JSON.stringify(m) + ' is genuinely ambiguous', () => assert.equal(quickCall(m), null));
  }
}

console.log('\nA trip with one person in it is untouched');
{
  t('never consults anything, whatever they typed', async () => {
    for (const m of ['ok', 'haha', '👍']) {
      const out = await shouldReply({ text: m, shared: false });
      assert.deepEqual(out, { reply: true, why: 'not shared' });
    }
  });
  // The above is the single most important line in the file: almost every
  // session is one person, and they must not pay for a feature they are not
  // using — no extra call, no added latency, no change in cost.
}

console.log('\nShared, and decided without a model');
{
  t('chatter is dropped with no call out', async () => {
    const out = await shouldReply({ text: 'haha ok', shared: true });
    assert.equal(out.reply, false);
    assert.equal(out.why, 'chatter');
  });
  t('an instruction wakes it with no call out', async () => {
    const out = await shouldReply({ text: 'add the zoo to day 3', shared: true });
    assert.equal(out.reply, true);
    assert.equal(out.why, 'addressed');
  });
}

console.log('\nWhat the agent is handed when it does speak');
{
  const held = [
    { who: 'her@x.com', text: 'what about tuesday instead' },
    { who: 'him@x.com', text: 'yeah tuesday works' },
  ];
  const block = heldFor(held, 'her@x.com');
  t('it gets everything it sat out', () => {
    assert.ok(block.includes('what about tuesday instead'));
    assert.ok(block.includes('yeah tuesday works'));
  });
  t('attributed, so "we decided" says who decided', () => {
    assert.ok(block.includes('him'), block);
  });
  t('and told not to act like it just walked in', () => {
    assert.match(block, /do not greet them or recap/i);
  });
  t('nothing held means nothing added', () => assert.equal(heldFor([], 'x'), ''));
}

console.log('\n' + n + ' passed');
