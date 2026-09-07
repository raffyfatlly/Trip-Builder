// Post a message into a chat session and return immediately.
//
// It deliberately does NOT wait for the reply. A turn can take a while and a
// build takes minutes; the client polls /api/state, and each poll advances the
// work by a bounded amount.

import { sendUserMessage, listEvents } from '../../lib/managedAgents.js';
import { MAX_TURNS_PER_SESSION } from '../../lib/config.js';
import { geoFrom, contextBlock, fromBlock } from '../../lib/context.js';
import { note } from '../../lib/journal.js';
import { billed } from '../../lib/billed.js';
import { allowed, leftOf } from '../../lib/credits.js';
import { userFrom } from '../../lib/auth.js';
import { shouldReply, heldFor, withoutAsk } from '../../lib/listen.js';
import { CTX_MARKER } from '../../lib/context.js';
import { readOwner, readHeld, appendHeld, markHeldSent, mayOpen, firestoreConfigured } from '../../lib/firestore.js';

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { session, text, files, client, memory, asked } = req.body || {};
  if (!session || typeof session !== 'string') {
    return res.status(400).json({ error: 'session required' });
  }
  if ((!text || !text.trim()) && !(files && files.length)) {
    return res.status(400).json({ error: 'nothing to send' });
  }

  try {
    // Out of credit is where a new turn stops, and only a NEW turn.
    //
    // raffy, 2026-09-05: "if they move beyond they can't use chat or rebuild
    // anymore except just edit their iteniry manually."
    //
    // A rebuild is a tool call inside a chat turn, so gating here covers both
    // with one check. Manual edits need no gate at all — they live in the
    // browser's own storage and are applied over the itinerary on render, so
    // they cost nothing and keep working exactly as they did.
    //
    // Nothing is checked in /api/advance: a turn already underway has been paid
    // for, and stopping it halfway leaves a half-built trip AND charges for it.
    let who = '';
    try { who = userFrom(req) || ''; } catch (e) { /* anonymous */ }
    const purse = await allowed(who, session);
    if (!purse.ok) {
      return res.status(402).json({
        error: 'out of credits',
        paywall: {
          signedIn: !!who,
          granted: purse.granted,
          used: purse.used,
          left: 0,
        },
      });
    }

    // No link gating here, and the key bills a real card, so a session cannot
    // run forever.
    const events = await listEvents(session);
    const turns = events.filter((e) => e.type === 'user.message').length;
    // A preview, not the message. Enough to see what they were asking when
    // something went wrong; not a second copy of a conversation that already
    // has one.
    note(session, 'msg', { turn: turns + 1, text, files: (files || []).length });
    if (turns >= MAX_TURNS_PER_SESSION) {
      return res.status(429).json({ error: 'This conversation has reached its limit.' });
    }

    // WHETHER THE AGENT SHOULD ANSWER THIS AT ALL.
    //
    // raffy, 2026-09-07: "allow them to chat in the same session ... but not
    // like automated response ... if they just talking between each other the
    // agent don't respond."
    //
    // A message sent to the agent IS a turn, and a turn is about $0.109, so
    // this decision has to happen BEFORE the message goes anywhere near it. On
    // a trip with one person in it nothing here runs at all — same path, same
    // cost, same speed as before. See lib/listen.js.
    let shared = false;
    let owner = null;
    if (firestoreConfigured()) {
      try {
        owner = await readOwner(session);
        // Reading is gated in /api/state; writing has to be gated too, or a
        // stranger with the session id can talk into somebody's trip — and
        // spend their own credits doing it, which makes it look consensual.
        if (!mayOpen(owner, who)) {
          return res.status(403).json({ error: 'That trip is not shared with you.' });
        }
        shared = !!(owner && (owner.guests || []).length);
      } catch (e) { /* unknown ownership behaves as a solo trip */ }
    }

    let held = [];
    if (shared) {
      try { held = await readHeld(session); } catch (e) { held = []; }
      // Synchronous, free, and predictable: @ or the composer's button, and
      // nothing else. See lib/listen.js for why the guessing went.
      const verdict = shouldReply({ text: text || '', shared, asked: !!asked });
      if (!verdict.reply) {
        // Said to the other person, not to the agent. It is kept where both of
        // them can see it and where the agent will read it the next time it
        // does speak — but nothing is woken and nothing is charged.
        try {
          // Anchored to the last thing said, so the browser can put it back in
          // the conversation where it happened rather than on the end of it.
          const spoken = [...events].reverse()
            .find((e) => e.type === 'user.message' || e.type === 'agent.message');
          await appendHeld(session, {
            who, text: String(text || '').trim(), at: Date.now(),
            after: spoken ? spoken.id : '',
          });
        } catch (e) {
          console.error('could not hold message:', e && e.message);
        }
        note(session, 'msg', { turn: turns + 1, held: true, why: verdict.why });
        return res.status(200).json({ ok: true, spoke: false, why: verdict.why });
      }
    }

    const content = [];
    const kept = [];
    for (const f of files || []) {
      if (!f || !f.file_id) continue;
      content.push(f.kind === 'image'
        ? { type: 'image', source: { type: 'file', file_id: f.file_id } }
        : { type: 'document', source: { type: 'file', file_id: f.file_id }, title: f.name || 'file' });
      if (f.doc && f.doc.url) kept.push(f.doc);
    }
    // The agent reads the attachment through the Files API, which gives it no
    // URL — so the link to the copy the app kept has to be told to it, or the
    // booking it files will have every detail off the confirmation except the
    // way back to the confirmation.
    if (kept.length) {
      content.push({ type: 'text', text:
        'The app has kept a copy of ' + (kept.length === 1 ? 'this attachment' : 'these attachments')
        + '. If you file a booking from '
        + (kept.length === 1 ? 'it' : 'them') + ', put the matching link on it as doc.url so they can open it '
        + 'from the card:\n'
        + kept.map((d) => '- ' + (d.name || 'attachment') + ': ' + d.url).join('\n') });
    }
    // On a shared trip the agent is told who is speaking, and what it missed.
    // Without the first it answers "we decided Tuesday" without knowing which
    // of them decided; without the second it replies to a message whose whole
    // meaning is in the three before it.
    // Only what it has not already been given. Held messages are kept now
    // rather than deleted (they are what the two of them said to each other,
    // and the app has to go on showing them), so "what it missed" is the ones
    // not yet marked as handed over.
    const fresh = held.filter((m) => !m.sent);
    if (shared && fresh.length) {
      // MARKED, SO IT NEVER APPEARS ON SCREEN.
      //
      // raffy, 2026-09-07, with a screenshot of it rendered as a chat bubble:
      // "this message shouldn't be displayed at all if possible ... this should
      // only happen background."
      //
      // He is right and this was a plain text block, so it drew as part of his
      // own message — the app showing him a transcript of what he had just said,
      // followed by instructions to itself. CTX_MARKER is what the display layer
      // strips (see display() in lib/managedAgents.js); every other piece of
      // background context already carries it and this one was simply missed.
      content.push({ type: 'text', text: CTX_MARKER + heldFor(fresh) });
    }
    // Who is speaking, in a block of its own. Glued to the front of the message
    // it broke the browser's optimistic bubble — see fromBlock in lib/context.js.
    if (shared && who) content.push({ type: 'text', text: fromBlock(who) });
    if (text && text.trim()) {
      // The @ is how they summoned it, not part of what they asked. Left in, a
      // reply tends to open by acknowledging being addressed.
      content.push({ type: 'text', text: shared ? withoutAsk(text) : text.trim() });
    }

    // Where and when they are, attached to every message so "now" is never
    // stale. Stripped before display — see CTX_MARKER.
    content.push({ type: 'text', text: contextBlock(geoFrom(req), client, memory) });

    await sendUserMessage(session, content);
    // Handed over, so it must not be handed over twice. Marked AFTER the send
    // rather than before: a send that fails leaves them unmarked, which is
    // recoverable, where marking first would lose them to the agent forever.
    if (shared && fresh.length) {
      const upTo = fresh.reduce((n, m) => Math.max(n, Number(m.at) || 0), 0);
      try { await markHeldSent(session, upTo); } catch (e) { /* next send marks it */ }
    }
    res.status(200).json({ ok: true, spoke: true });
  } catch (err) {
    console.error('send failed:', err);
    res.status(500).json({ error: 'Could not send that.' });
  }
}

export default billed(handler);
