import { advanceState, resumeChat } from '../../lib/managedAgents.js';
import { billed } from '../../lib/billed.js';

// The slow half of the loop: answer the agent's pending tool calls, start a
// builder when it asks for one, take the build forward by a step.
//
// Split out from /api/state on 2026-09-01. Doing this work inside the poll
// that renders the page meant one poll could make two model calls, exceed
// Vercel's 300-second ceiling, and return nothing — so the conversation looked
// lost when it was only unread. Now the page always renders from /api/state
// and this can take as long as it takes.
//
// Safe to call repeatedly: every step is idempotent against the event log.

export const config = { maxDuration: 300 };

async function handler(req, res) {
  const session = (req.query && req.query.session) || (req.body && req.body.session);
  if (!session || typeof session !== 'string') {
    return res.status(400).json({ error: 'session required' });
  }
  try {
    // A turn that died leaves the session idle with nothing pending, so
    // advancing alone will not restart it. `resume` is the retry button.
    if (req.query && req.query.resume) {
      try { await resumeChat(session); } catch (err) { console.error('resume failed:', err); }
    }
    res.status(200).json(await advanceState(session));
  } catch (err) {
    console.error('advance failed:', err);
    res.status(500).json({ error: 'Could not advance the conversation.' });
  }
}

export default billed(handler);
