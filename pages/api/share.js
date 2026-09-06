// Making and killing a share link.
//
// raffy, 2026-09-06: "i want to explore the idea of sharing their itenary to
// people." A link rather than a file, because a PDF of a trip is wrong the
// moment a hotel changes and a link is always the current trip.
//
// The token is not the session id. A session id is the key to the whole
// conversation — the chat, the credits, the ability to send messages as them —
// and a trip gets pasted into a group chat. See lib/share.js.

import { makeShare, revokeShare, shareReady, looksLikeToken } from '../../lib/share.js';
import { getState } from '../../lib/managedAgents.js';
import { billed } from '../../lib/billed.js';

async function handler(req, res) {
  if (!shareReady()) return res.status(501).json({ error: 'Sharing is not set up on this deployment.' });

  if (req.method === 'DELETE') {
    const token = String((req.query && req.query.token) || '');
    if (!looksLikeToken(token)) return res.status(400).json({ error: 'No such link.' });
    await revokeShare(token);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST or DELETE' });

  const session = String((req.body && req.body.session) || '');
  if (!/^sesn_.{16,}$/.test(session)) return res.status(400).json({ error: 'session required' });

  // Only a trip that exists can be shared. Sending somebody a link to an empty
  // page is worse than the button being disabled.
  try {
    const state = await getState(session);
    const it = state && state.itinerary;
    if (!it || !((it.days || []).length)) {
      return res.status(400).json({ error: 'There is nothing to share until the trip is built.' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Could not read that trip.' });
  }

  const token = await makeShare(session);
  if (!token) return res.status(500).json({ error: 'Could not make a link.' });
  return res.status(200).json({ token, path: '/t/' + token });
}

export default billed(handler);
