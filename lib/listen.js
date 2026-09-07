// In a shared trip the agent speaks when it is ASKED to. Nothing else.
//
// raffy, 2026-09-07, after testing it with Syahirah: "syahirah said hi, I said
// hi, then when one of us ask a question, it send this. that's a bit weird.
// create a mechanism that's not too complicated. maybe we can @ something to
// ask agent to reply or something? but make it easy for user to invoke."
//
// THE FIRST VERSION GUESSED, and guessing is the wrong shape for this. It read
// each message and decided whether it was for the agent — free rules at the
// two ends, a cheap model for the middle. It was accurate enough on paper and
// still felt wrong in use, for a reason no accuracy number captures: **you
// could not tell, before pressing send, whether it was going to answer.**
// Two people talking to each other cannot relax if a third party might join at
// any moment, and when it did join it had "hi / hi" in its context and no idea
// what to do with it.
//
// So the rule is now one sentence: **type @ and it answers; otherwise it does
// not.** No model call, no cost, no latency, and — the point — no surprise.
// The composer has a button that types the @ for them, so invoking it is one
// tap rather than remembering a convention.
//
// What this deliberately gives up: "add the zoo to day 3" no longer wakes it on
// its own. That is a real loss and it is worth it. A predictable assistant you
// summon beats a clever one that might be listening.
//
// A trip with ONE person in it is untouched — no @ needed, every message
// answered, exactly as before. That is almost every session.

// No imports. That is the measure of the change: deciding whether to answer
// used to need the network, a model, a key and a timeout. It now needs a
// regular expression.

const clean = (s) => String(s == null ? '' : s).trim();

// Being asked. One rule, and it is the whole mechanism.
//
// A bare "@" counts, and so does "@trip", "@claude", "@ what about tuesday" —
// anything with an @ in it. Deliberately loose: somebody reaching for the
// convention should not have to get it exactly right, and an email address in
// a message is a fine reason to answer too (they are almost certainly showing
// the agent a booking confirmation).
export const ASK = /@/;

/** Did they ask the agent? */
export const asksAgent = (text) => ASK.test(clean(text));

/** Strip the marker so the agent does not read its own summons as the ask. */
// Order matters, and got this wrong once: stripping a bare "@" first ate the
// marker off "@trip find a hotel" and left "trip find a hotel" — the name read
// as part of the question. The longer pattern has to be tried first.
export const withoutAsk = (text) => {
  const t = clean(text);
  const cut = /^@\S+\s+/.test(t) ? t.replace(/^@\S+\s+/, '')
    : /^@\s*/.test(t) ? t.replace(/^@\s*/, '')
      : t;
  // Never return nothing: a message that was only "@" still has to give the
  // agent something to answer.
  return cut.trim() || t;
};

/**
 * Should the agent answer this message?
 *
 * `shared` false short-circuits: a trip with one person in it always gets an
 * answer, exactly as before. `asked` lets the client say so outright — the
 * composer's button sets it — so invoking never depends on parsing text.
 *
 * Synchronous now. The old version awaited a model call on every ambiguous
 * message; this one cannot fail, cannot cost anything, and cannot be slow.
 */
export function shouldReply({ text, shared = false, asked = false }) {
  if (!shared) return { reply: true, why: 'not shared' };
  if (asked) return { reply: true, why: 'asked' };
  if (asksAgent(text)) return { reply: true, why: '@' };
  return { reply: false, why: 'not asked' };
}

/**
 * What they said to each other since the agent last spoke.
 *
 * Trimmed, because the first version handed over everything and the agent got
 * "hi / hi" as context for a question about hotels — which is where raffy's
 * "that's a bit weird" came from. Greetings and one-word reactions carry no
 * information the agent can use; what it needs is the substance it missed.
 */
const NOISE = /^(hi+|hey+|hello+|yo|morning|ok(ay)?|k|yeah?|yep|yup|ya|sure|nice|cool|great|haha+|hehe+|lol|wow|true|same|no+|nope|nah|hmm+|ah|oh|thanks|thx|ty|np|perfect|good|fine|done|yes|yay|lah)[\s!.,?]*$/i;

/**
 * Put the side-conversation back where it happened.
 *
 * raffy, 2026-09-07: "its weird to see the chats." Every held message used to
 * be appended after the whole transcript, so a remark made three turns ago sat
 * below an answer given since — a conversation that reads in the wrong order,
 * and one that got longer every time somebody spoke without summoning the
 * agent.
 *
 * Each held message carries the id of the last thing said before it (`after`),
 * so it can be dropped straight back in there. Anything whose anchor is not in
 * the transcript — an aside from before the first message, or one whose anchor
 * has been trimmed out of a long log — goes at the end, which is where it used
 * to go and is still the safe answer.
 */
export function joinHeld(transcript, held) {
  const rows = (held || []).filter((m) => m && clean(m.text));
  const list = transcript || [];
  if (!rows.length) return list;

  const asideRow = (m, i) => ({
    role: 'user',
    text: clean(m.text),
    who: m.who || '',
    // Marked so the browser can show it as said-to-each-other rather than as a
    // message the agent has answered.
    aside: true,
    id: 'held:' + (m.at || i),
  });

  // The 'ready' card belongs to the message above it, so an aside anchored to
  // that message goes after the pair rather than between them.
  const base = (id) => String(id || '').replace(/:ready$/, '');
  const lastAt = new Map();
  list.forEach((r, i) => lastAt.set(base(r.id), i));

  const at = new Map();
  const tail = [];
  rows.forEach((m, i) => {
    const row = asideRow(m, i);
    const anchor = m.after && lastAt.has(base(m.after)) ? lastAt.get(base(m.after)) : null;
    if (anchor === null) { tail.push(row); return; }
    if (!at.has(anchor)) at.set(anchor, []);
    at.get(anchor).push(row);
  });

  const out = [];
  list.forEach((r, i) => {
    out.push(r);
    for (const row of at.get(i) || []) out.push(row);
  });
  return [...out, ...tail];
}

export function heldFor(messages) {
  // Emoji-only carries nothing the agent can use either, and NOISE is a word
  // list so it never matched them.
  const wordless = /^[\s\p{Extended_Pictographic}\p{Emoji_Component}!?.,…-]*$/u;
  const held = (messages || [])
    .map((m) => ({ ...m, text: clean(m.text) }))
    .filter((m) => m.text && !NOISE.test(m.text) && !wordless.test(m.text))
    .slice(-12);
  if (!held.length) return '';
  // Everybody by name, including whoever is doing the asking.
  //
  // This used to render the asker as "They" and everyone else by name, which
  // is backwards — and with three people in a trip it makes the transcript
  // unattributable: the agent cannot say "Sarah wants a lie-in, Adam booked the
  // hike" if one of them is an anonymous "They". The agent is a third party to
  // all of them; there is no first person here.
  const name = (w) => (w ? w.split('@')[0] : 'Someone');
  return 'For context, what they have been saying to each other:\n'
    + held.map((m) => name(m.who) + ': ' + m.text).join('\n')
    + '\n\nOnly the newest message is addressed to you. Answer that.'
    + ' Do not reply to the lines above, greet them, or recap what they said.';
}
