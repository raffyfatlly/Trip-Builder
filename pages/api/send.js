// Post a message into a chat session and return immediately.
//
// It deliberately does NOT wait for the reply. A turn can take a while and a
// build takes minutes; the client polls /api/state, and each poll advances the
// work by a bounded amount.

import { sendUserMessage, listEvents } from '../../lib/managedAgents.js';
import { MAX_TURNS_PER_SESSION } from '../../lib/config.js';
import { geoFrom, contextBlock } from '../../lib/context.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { session, text, files, client, memory } = req.body || {};
  if (!session || typeof session !== 'string') {
    return res.status(400).json({ error: 'session required' });
  }
  if ((!text || !text.trim()) && !(files && files.length)) {
    return res.status(400).json({ error: 'nothing to send' });
  }

  try {
    // No link gating here, and the key bills a real card, so a session cannot
    // run forever.
    const events = await listEvents(session);
    const turns = events.filter((e) => e.type === 'user.message').length;
    if (turns >= MAX_TURNS_PER_SESSION) {
      return res.status(429).json({ error: 'This conversation has reached its limit.' });
    }

    const content = [];
    for (const f of files || []) {
      if (!f || !f.file_id) continue;
      content.push(f.kind === 'image'
        ? { type: 'image', source: { type: 'file', file_id: f.file_id } }
        : { type: 'document', source: { type: 'file', file_id: f.file_id }, title: f.name || 'file' });
    }
    if (text && text.trim()) content.push({ type: 'text', text: text.trim() });

    // Where and when they are, attached to every message so "now" is never
    // stale. Stripped before display — see CTX_MARKER.
    content.push({ type: 'text', text: contextBlock(geoFrom(req), client, memory) });

    await sendUserMessage(session, content);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send failed:', err);
    res.status(500).json({ error: 'Could not send that.' });
  }
}
