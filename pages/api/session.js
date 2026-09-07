// Mint an anonymous session.
//
// This is the whole of "separating people": the browser gets an opaque session
// id and keeps it in localStorage. Two people on two phones get two ids and
// never see each other's chat. No accounts, no links, no admin.

import { createSession } from '../../lib/managedAgents.js';
import { syncChatAgent } from '../../lib/agentSync.js';
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
    res.status(200).json({ session: session.id });
  } catch (err) {
    console.error('session create failed:', err);
    res.status(500).json({ error: 'Could not start a session.' });
  }
}
