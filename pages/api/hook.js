// The landing page's free question. One per session, answered directly — see
// lib/hook.js for why this is not the chat agent.
export const config = { maxDuration: 30 };

import { askHook } from '../../lib/hook.js';
import { claimOnce, firestoreConfigured } from '../../lib/firestore.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const question = String((req.body && req.body.question) || '').trim();
  const session = String((req.body && req.body.session) || '').trim();
  if (!question) return res.status(400).json({ error: 'question required' });
  if (question.length > 600) return res.status(400).json({ error: 'question too long' });

  // The client already hides the box after one use; this is the version of
  // that rule that a curious visitor cannot get around by editing localStorage
  // or replaying the request. No session id, no free pass — it means the
  // browser has not bootstrapped one yet, which the client always does first.
  if (session && firestoreConfigured()) {
    const first = await claimOnce('hookAsk', session, { question: question.slice(0, 200) });
    if (!first) return res.status(429).json({ error: 'already used', answer: '' });
  }

  const { answer, error } = await askHook(question);
  if (!answer) {
    return res.status(502).json({
      error: error || 'no answer',
      answer: "Couldn't get an answer for that just now — try again in a moment, or jump straight into building the trip and ask me there.",
    });
  }
  return res.status(200).json({ answer });
}
