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

async function handler(req, res) {
  const session = req.query.session;
  if (!session || typeof session !== 'string') {
    return res.status(400).json({ error: 'session required' });
  }
  try {
    res.status(200).json(await getState(session));
  } catch (err) {
    console.error('state failed:', err);
    res.status(500).json({ error: 'Could not read the conversation.' });
  }
}

export default billed(handler);
