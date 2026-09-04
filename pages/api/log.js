// What the browser saw.
//
// The server journal knows what it was asked to do; it does not know that the
// preview refused to draw, or that a page threw, or that somebody downloaded
// their trip and left. Those are exactly the things a beta tester reports as
// "it didn't work", so the page says them out loud here.
//
// Deliberately dumb: a session, an event name, a few fields, no auth. Anyone
// who can guess a session id can already read that session's trip, so this adds
// no exposure — and it writes at most a bounded line into that session's own
// record.

import { note } from '../../lib/journal.js';

// A closed list. An open one is an invitation to fill the journal with
// whatever a page happens to feel like sending.
const ALLOWED = new Set([
  'open', 'onboard', 'build.asked', 'preview.failed', 'download', 'error', 'edit',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { session, ev, data } = req.body || {};
  if (!session || typeof session !== 'string') return res.status(400).json({ error: 'session required' });
  if (!ALLOWED.has(ev)) return res.status(400).json({ error: 'unknown event' });

  const clean = {};
  for (const k of Object.keys(data || {}).slice(0, 8)) {
    const v = data[k];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') clean[k] = v;
  }
  // Not awaited: the page is not waiting to hear that its log line landed.
  note(session, ev, clean);
  res.status(200).json({ ok: true });
}
