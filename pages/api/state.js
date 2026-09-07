// The read endpoint. Reports the transcript and the current itinerary, and
// does nothing else — no model calls, no writes.
//
// It used to advance both sessions on every poll, which is what made raffy's
// Italy trip render blank: two model calls in the request that draws the page,
// past Vercel's 300-second ceiling, so nothing came back. The advancing lives
// in /api/advance now and the page no longer waits on it.
//
// Nothing is stored. The itinerary is replayed from the builder session's own
// event log, and the builder session id is recovered from the chat log.

// Reading is two event listings and a Firestore read. If it has not answered
// in 30 seconds something is wrong upstream, and failing fast lets the browser
// say so instead of showing an empty conversation.
export const config = { maxDuration: 30 };

import { getState } from '../../lib/managedAgents.js';
import { billed } from '../../lib/billed.js';
import { allowed } from '../../lib/credits.js';
import { userFrom } from '../../lib/auth.js';
import { readOwner, readHeld, firestoreConfigured } from '../../lib/firestore.js';

async function handler(req, res) {
  const session = req.query.session;
  if (!session || typeof session !== 'string') {
    return res.status(400).json({ error: 'session required' });
  }
  try {
    // The balance rides along with the state the app already polls, rather than
    // getting an endpoint of its own. It is read from the same document the
    // charge is written to, so what the bar shows and what the gate enforces
    // can never disagree — and the poll is already happening.
    let who = '';
    try { who = userFrom(req) || ''; } catch (e) { /* anonymous */ }
    const [state, purse] = await Promise.all([getState(session), allowed(who, session)]);

    // Messages the two of them said to each other while the agent stayed quiet.
    //
    // These are not in the agent's event log — that is the whole point, a
    // message sent there costs a turn — so the transcript has to be joined here
    // or the app looks like it swallowed what somebody typed. They sit at the
    // end because that is when they were said: everything before them has
    // already been through the agent.
    let owner = null;
    let held = [];
    if (firestoreConfigured()) {
      try {
        owner = await readOwner(session);
        if (owner && (owner.guests || []).length) held = await readHeld(session);
      } catch (e) { /* a trip whose sharing cannot be read is shown unshared */ }
    }
    const transcript = held.length
      ? [...(state.transcript || []), ...held.map((m, i) => ({
        role: 'user',
        text: String(m.text || ''),
        who: m.who || '',
        // Marked so the browser can show it as said-to-each-other rather than
        // as a message the agent has answered.
        aside: true,
        id: 'held:' + (m.at || i),
      }))]
      : state.transcript;

    res.status(200).json({
      ...state,
      transcript,
      // Who is in this trip, so the app can put a name on the other person's
      // messages and show the invite panel only to the owner.
      party: owner && owner.who
        ? { owner: owner.who, guests: owner.guests || [], me: who, shared: !!(owner.guests || []).length }
        : null,
      credits: purse.unmetered ? null : {
        left: purse.left, granted: purse.granted, used: purse.used,
        plan: purse.plan, build: purse.build, signedIn: purse.who,
      },
    });
  } catch (err) {
    console.error('state failed:', err);
    res.status(500).json({ error: 'Could not read the conversation.' });
  }
}

export default billed(handler);
