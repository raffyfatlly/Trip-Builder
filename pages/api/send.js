// Post a message into a chat session and return immediately.
//
// It deliberately does NOT wait for the reply. A turn can take a while and a
// build takes minutes; the client polls /api/state, and each poll advances the
// work by a bounded amount.

import { sendUserMessage, listEvents } from '../../lib/managedAgents.js';
import { MAX_TURNS_PER_SESSION } from '../../lib/config.js';
import { geoFrom, contextBlock } from '../../lib/context.js';
import { note } from '../../lib/journal.js';
import { billed } from '../../lib/billed.js';

async function handler(req, res) {
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
    // A preview, not the message. Enough to see what they were asking when
    // something went wrong; not a second copy of a conversation that already
    // has one.
    note(session, 'msg', { turn: turns + 1, text, files: (files || []).length });
    if (turns >= MAX_TURNS_PER_SESSION) {
      return res.status(429).json({ error: 'This conversation has reached its limit.' });
    }

    const content = [];
    const kept = [];
    for (const f of files || []) {
      if (!f || !f.file_id) continue;
      content.push(f.kind === 'image'
        ? { type: 'image', source: { type: 'file', file_id: f.file_id } }
        : { type: 'document', source: { type: 'file', file_id: f.file_id }, title: f.name || 'file' });
      if (f.doc && f.doc.url) kept.push(f.doc);
    }
    // The agent reads the attachment through the Files API, which gives it no
    // URL — so the link to the copy the app kept has to be told to it, or the
    // booking it files will have every detail off the confirmation except the
    // way back to the confirmation.
    if (kept.length) {
      content.push({ type: 'text', text:
        'The app has kept a copy of ' + (kept.length === 1 ? 'this attachment' : 'these attachments')
        + '. If you file a booking from '
        + (kept.length === 1 ? 'it' : 'them') + ', put the matching link on it as doc.url so they can open it '
        + 'from the card:\n'
        + kept.map((d) => '- ' + (d.name || 'attachment') + ': ' + d.url).join('\n') });
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

export default billed(handler);
