// Mint an anonymous session.
//
// This is the whole of "separating people": the browser gets an opaque session
// id and keeps it in localStorage. Two people on two phones get two ids and
// never see each other's chat. No accounts, no links, no admin.

import { createSession } from '../../lib/managedAgents.js';
import { syncChatAgent } from '../../lib/agentSync.js';
import { claimOwner, firestoreConfigured } from '../../lib/firestore.js';
import { userFrom } from '../../lib/auth.js';
import { CHAT_AGENT_ID, ENV_ID } from '../../lib/config.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    // Make sure the agent this session pins to is running the tools and prompt
    // in this deploy. A session takes the agent version it starts on, so this
    // has to happen BEFORE the create — after it, the new session is already
    // pinned to the old one. Costs a single GET on a cold start and nothing
    // afterwards; never throws, so a sync problem cannot stop a conversation.
    await syncChatAgent();
    const session = await createSession(CHAT_AGENT_ID, ENV_ID);

    // Owned from birth, when we know who is asking.
    //
    // Waiting for the first /api/me claim left a window where a brand-new
    // session belonged to nobody, and an unowned session is exactly what the
    // next person to sign in on that phone used to walk off with. An anonymous
    // session stays unowned on purpose — it gets its owner when somebody signs
    // in and claims it, which is the one ownership transition that should
    // happen.
    const email = firestoreConfigured() ? userFrom(req) : '';
    if (email) {
      try {
        await claimOwner(session.id, email);
      } catch (err) {
        // Never fail a new conversation over the bookkeeping. /api/me claims it
        // on the next load.
        console.error('could not record session owner:', err && err.message);
      }
    }

    res.status(200).json({ session: session.id });
  } catch (err) {
    console.error('session create failed:', err);
    res.status(500).json({ error: 'Could not start a session.' });
  }
}
