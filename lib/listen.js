// When two people are planning together, the agent listens and only speaks when
// it is being spoken to.
//
// raffy, 2026-09-07: "allow them to chat in the same session the two different
// user with each other but the agent can also know. but not like automated
// response. a smart response... if they just talking between each other the
// agent don't respond. y know what i mean?"
//
// THE COST PROBLEM COMES FIRST. Chat is 78% of what this app spends and one
// turn is about $0.109. Waking the agent for "haha ok" is not just noisy, it is
// the single most expensive way to say nothing. So the decision to speak is
// made BEFORE the agent is woken, by something ~350x cheaper, and most of the
// time by nothing at all.
//
// Three gates, cheapest first:
//
//   1. NOT SHARED -> always reply. A trip with one person in it behaves exactly
//      as it did before any of this existed: no extra call, no added latency,
//      no change in cost. This matters more than the rest of the file — almost
//      every session is one person, and they must not pay for a feature they
//      are not using.
//   2. Free local rules. A message that names the agent is for the agent; a
//      bare "ok" never is. These are the two ends of the distribution and they
//      are most of the traffic.
//   3. The middle, and only the middle, goes to the cheap worker model with the
//      last few messages for context — about $0.0003, against $0.109 for
//      guessing wrong in the expensive direction.
//
// When it does decide to speak, the agent is handed everything said since it
// last spoke, attributed. It should read as somebody who was in the room the
// whole time, not somebody who just walked in.

import { fetchWith } from './net.js';
import { setting, loadConfig } from './settings.js';

const API = 'https://openrouter.ai/api/v1/chat/completions';
const KEY = () => setting('OPENROUTER_API_KEY', 'openrouterKey');
// The same worker the research desk uses. Overridable on its own so a bad
// judge can be swapped without touching research.
const JUDGE = () => setting('LISTEN_MODEL', 'listenModel',
  setting('RESEARCH_MODEL', 'researchModel', 'deepseek/deepseek-chat-v3-0324'));
const T = 8000;

const clean = (s) => String(s == null ? '' : s).trim();

// Being spoken to. Not clever on purpose: these are the cases where a model
// call would be spending money to agree with a regular expression.
//
// The agent has no name in the product, so people address it the way people do
// address assistants — by asking it something, or by telling it to do
// something. "hey", "@", and the app's own name are the explicit forms.
const ADDRESSED = /(^|\s)(@|hey\s+(claude|assistant|bot|agent|trip)|(claude|assistant|agent))\b/i;

// A reply to the other person, not to the app. Short, and complete in itself.
const CHATTER = new RegExp('^(' + [
  'ok(ay)?', 'k', 'yeah?', 'yep', 'yup', 'ya', 'sure', 'nice', 'cool', 'great',
  'haha+', 'hehe+', 'lol', 'lmao', 'omg', 'wow', 'true', 'agreed', 'same',
  'no+', 'nope', 'nah', 'maybe', 'idk', 'hmm+', 'ah', 'oh', 'ic', 'i see',
  'thanks', 'thank you', 'thx', 'ty', 'np', 'sorry', 'wait', 'ready',
  'up to you', 'you decide', 'whatever you want', 'both fine', 'either',
  'love it', 'perfect', 'good', 'fine', 'done', 'yes', 'yay',
].join('|') + ')[\\s!.,?😂🤣👍🙏❤️😅🥲😍✨]*$', 'i');

// Only emoji, or only punctuation. Never for the agent.
const NO_WORDS = /^[\s\p{Extended_Pictographic}\p{Emoji_Component}!?.,…-]*$/u;

// A single chatter word is chatter; so is a string of them. "haha ok" and
// "yeah sure nice" are two people agreeing with each other, and paying a model
// to tell us that is the waste this file exists to avoid.
const ONE_WORD = new RegExp('^(' + [
  'ok(ay)?', 'k', 'yeah?', 'yep', 'yup', 'ya', 'sure', 'nice', 'cool', 'great',
  'haha+', 'hehe+', 'lol', 'lmao', 'omg', 'wow', 'true', 'agreed', 'same',
  'no+', 'nope', 'nah', 'hmm+', 'ah', 'oh', 'thanks', 'thx', 'ty', 'np',
  'perfect', 'good', 'fine', 'done', 'yes', 'yay', 'love', 'it', 'lah', 'la',
].join('|') + ')$', 'i');

const allChatter = (t) => {
  const words = t.toLowerCase().replace(/[!.,?…]/g, ' ').split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 5 && words.every((w) => ONE_WORD.test(w));
};

// Told to do something the app does. An imperative opening is the clearest
// signal there is that a message is for the assistant and not for the person
// sitting next to you — nobody tells their spouse to "add Universal Studios to
// day 2".
const INSTRUCTION = new RegExp('^(please\\s+)?(' + [
  'add', 'remove', 'delete', 'drop', 'change', 'move', 'swap', 'replace',
  'book', 'find', 'search', 'look up', 'check', 'show', 'give', 'make',
  'plan', 'build', 'update', 'rename', 'shift', 'put', 'set', 'cancel',
  'can you', 'could you', 'would you', 'lets', "let's",
].join('|') + ')\\b', 'i');

/**
 * Decide locally, or say you cannot.
 *
 * Returns true / false when it is sure, and null when the question is real —
 * which is the only case worth paying a model for.
 */
export function quickCall(text) {
  const t = clean(text);
  if (!t) return false;
  if (NO_WORDS.test(t)) return false;
  if (ADDRESSED.test(t)) return true;
  if (INSTRUCTION.test(t)) return true;
  if (CHATTER.test(t) || allChatter(t)) return false;
  // A question mark is weak evidence on its own — people ask each other things
  // constantly — so it is deliberately NOT a rule here. It goes to the judge.
  return null;
}

const SYSTEM = `You decide whether a travel-planning assistant should speak.

Two people are planning a trip together in one chat. The assistant is in the
room with them. You see the recent messages and the newest one.

Answer with exactly one word: SPEAK or STAY.

SPEAK when the newest message asks the assistant for something, gives it an
instruction, asks a question it would know the answer to (prices, places,
times, what to do), or settles a decision it should act on — "ok let's do
Tuesday then" is a decision the assistant should record.

STAY when the two people are talking to each other: reacting, agreeing,
joking, asking each other's opinion, or making arrangements between themselves
that the assistant has nothing to add to.

When it is genuinely ambiguous, answer STAY. A quiet assistant is a good
assistant; one that answers a message meant for someone else is worse than one
that waits to be asked.`;

/**
 * Should the agent answer this message?
 *
 * `shared` false short-circuits everything: a trip with one person in it always
 * gets an answer, exactly as before. Never throws — a judge that is down or
 * slow returns to the safe side, and for a shared trip the safe side is STAY:
 * a missed reply is one "@" away from being fixed, while an unwanted one has
 * already been paid for and already interrupted them.
 */
export async function shouldReply({ text, recent = [], shared = false }) {
  if (!shared) return { reply: true, why: 'not shared' };

  const quick = quickCall(text);
  if (quick === true) return { reply: true, why: 'addressed' };
  if (quick === false) return { reply: false, why: 'chatter' };

  await loadConfig();
  if (!KEY()) {
    // No judge configured. Answer, because the alternative is an app that
    // silently ignores people.
    return { reply: true, why: 'no judge' };
  }

  const lines = recent.slice(-6)
    .map((m) => (m.who ? m.who.split('@')[0] : 'someone') + ': ' + clean(m.text).slice(0, 200))
    .join('\n');

  try {
    const r = await fetchWith(API, T, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + KEY(),
        'content-type': 'application/json',
        'http-referer': 'https://trip-builder-two.vercel.app',
        'x-title': 'Trip Builder listen',
      },
      body: JSON.stringify({
        model: JUDGE(),
        max_tokens: 4,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: (lines ? 'Recent:\n' + lines + '\n\n' : '')
            + 'Newest message:\n' + clean(text).slice(0, 600) },
        ],
      }),
    });
    if (!r.ok) return { reply: false, why: 'judge ' + r.status };
    const d = await r.json();
    const said = clean(((d.choices || [])[0] || {}).message?.content).toUpperCase();
    return { reply: said.startsWith('SPEAK'), why: 'judged ' + (said || '?'), usage: d.usage || null };
  } catch (err) {
    return { reply: false, why: 'judge failed' };
  }
}

/**
 * Everything said since the agent last spoke, as one block it can read.
 *
 * The agent is handed this when it IS woken, so it sees the conversation it sat
 * out. Without it the agent answers the last message having missed the three
 * that set it up, which reads as somebody who just walked in — the opposite of
 * what raffy asked for.
 */
export function heldFor(messages, me) {
  const held = (messages || []).filter((m) => clean(m.text));
  if (!held.length) return '';
  const name = (w) => (!w ? 'Someone' : w === me ? 'They' : w.split('@')[0]);
  return 'While you were listening, they said this to each other:\n'
    + held.map((m) => name(m.who) + ': ' + clean(m.text)).join('\n')
    + '\n\nThe newest message is for you. Answer it in that context —'
    + ' do not greet them or recap what they said, you were already here.';
}
