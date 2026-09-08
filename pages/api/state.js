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
import { allowed, rebuildCredits } from '../../lib/credits.js';
import { userFrom } from '../../lib/auth.js';
import { readOwner, readHeld, mayOpen, firestoreConfigured } from '../../lib/firestore.js';
import { joinHeld } from '../../lib/listen.js';
import { runChores } from '../../lib/chores.js';

async function handler(req, res) {
  const session = req.query.session;
  if (!session || typeof session !== 'string') {
    return res.status(400).json({ error: 'session required' });
  }
  // Errands I left for the deployment, because this session cannot reach every
  // host it can. Fire and forget, at most one every twenty seconds per
  // instance, and never awaited — see lib/chores.js.
  runChores();

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
    // or the app looks like it swallowed what somebody typed. Each one goes back
    // where it was said rather than onto the end of the list; see joinHeld.
    let owner = null;
    let held = [];
    if (firestoreConfigured()) {
      try {
        owner = await readOwner(session);
        // WHO IS ALLOWED TO READ THIS CONVERSATION.
        //
        // Sharing was only ever enforced on the CLAIM path — /api/me refused to
        // add somebody else's trip to your account — which protected the trip
        // LIST and nothing else. The conversation itself was readable by anyone
        // holding the session id, which makes the guest list decorative.
        //
        // An unowned session stays open: anonymous trips have no owner and must
        // keep working, and so must every session created before owners existed.
        // The read-only share link does not come through here at all — pages/
        // t/[s].js resolves its token and calls getState directly.
        if (!mayOpen(owner, who)) {
          return res.status(403).json({ error: 'That trip is not shared with you.' });
        }
        if (owner && (owner.guests || []).length) held = await readHeld(session);
      } catch (e) { /* a trip whose sharing cannot be read is shown unshared */ }
    }
    const transcript = held.length ? joinHeld(state.transcript, held) : state.transcript;

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
        // What a build costs, so the app can offer a top-up BEFORE somebody
        // asks for one they cannot afford. Without it the client has to guess,
        // and a guess here either nags people who are fine or lets somebody
        // walk into a refusal.
        buildCost: rebuildCredits(),
        // Building is the paid part, so the app has to know which side of that
        // line somebody is on before they ask.
        paid: !!purse.paid,
      },
    });
  } catch (err) {
    console.error('state failed:', err);
    res.status(500).json({ error: 'Could not read the conversation.' });
  }
}

export default billed(handler);
