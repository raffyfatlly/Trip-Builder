// The landing page's ask box, answered directly — see lib/hook.js for why
// this is not the chat agent.
//
// raffy, 2026-09-16: "it didn't give answer like before. it bring directly
// to chat session, which contains some of my past question." Root cause:
// research's own internal ceiling (lib/research.js) is 70s, longer than
// this function's OLD 60s maxDuration — one research call could carry a
// request straight through Vercel's hard timeout, which the browser sees
// as a fetch that simply never answers. The ask box's own error handling
// then quietly sent him to /, which resumed whatever old session his
// browser already had — looking exactly like a random old conversation for
// no reason. lib/hook.js now bounds every tool call to what is actually
// left of its own budget, so this should not recur; 90s here is headroom
// on top of that, not the primary fix.
export const config = { maxDuration: 90 };

import { askHook } from '../../lib/hook.js';
import { readHookAsks, writeHookAsks, firestoreConfigured } from '../../lib/firestore.js';
import { geoFrom } from '../../lib/context.js';

// A quiet ceiling, not a "free question" — raffy, 2026-09-16: "don't put the
// one free question thing etc." Nothing about hitting this is shown as a
// limit; it just stops spending on the model and gives back a normal-looking
// answer that still points at planning. Whoever is asking never sees a
// number.
const SOFT_CAP = 8;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const question = String((req.body && req.body.question) || '').trim();
  const session = String((req.body && req.body.session) || '').trim();
  const client = (req.body && req.body.client) || null;
  if (!question) return res.status(400).json({ error: 'question required' });
  if (question.length > 600) return res.status(400).json({ error: 'question too long' });

  if (session && firestoreConfigured()) {
    const asked = await readHookAsks(session).catch(() => 0);
    if (asked >= SOFT_CAP) {
      return res.status(200).json({
        answer: "Let's get into the specifics together — tell me about the trip and I'll start putting it together properly.",
      });
    }
    writeHookAsks(session, asked + 1).catch(() => {});
  }

  const { answer, error } = await askHook(question, { geo: geoFrom(req), client });
  if (!answer) {
    return res.status(502).json({
      error: error || 'no answer',
      answer: "Couldn't get an answer for that just now — try again in a moment, or jump straight into building the trip and ask me there.",
    });
  }
  return res.status(200).json({ answer });
}
