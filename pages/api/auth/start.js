// Step one: send a six digit code to an email address.

import { authConfigured, looksLikeEmail, normaliseEmail, sendCode } from '../../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!authConfigured()) return res.status(501).json({ error: 'Accounts are not set up on this deployment.' });

  const email = normaliseEmail(req.body && req.body.email);
  if (!looksLikeEmail(email)) return res.status(400).json({ error: 'That does not look like an email address.' });

  try {
    const r = await sendCode(email);
    if (!r.ok) return res.status(400).json({ error: r.error });
    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error('auth start failed:', err);
    return res.status(500).json({ error: 'Could not send the code. Try again.' });
  }
}
