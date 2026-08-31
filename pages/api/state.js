// The poll endpoint. Each call advances both sessions as far as they can go
// right now — resolving pending tool calls, starting the builder when the chat
// agent asks for it — then reports the transcript and the current itinerary.
//
// Nothing is stored. The itinerary is replayed from the builder session's own
// event log, and the builder session id is recovered from the chat log.

import { getState } from '../../lib/managedAgents.js';

export default async function handler(req, res) {
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
