// Step two: check the code, create or find the account, and hand back both a
// session cookie and whatever trips that account already has.
//
// The browser also sends the trips it is holding locally, so signing in on a
// device you have been using anonymously keeps that work rather than replacing
// it with an empty account.

import {
  authConfigured, looksLikeEmail, normaliseEmail, normalisePhone,
  checkCode, makeToken, cookieHeader,
} from '../../../lib/auth.js';
import { configured, upsertUser, claimTrip, listTrips } from '../../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!authConfigured() || !configured()) {
    return res.status(501).json({ error: 'Accounts are not set up on this deployment.' });
  }

  const body = req.body || {};
  const email = normaliseEmail(body.email);
  const code = String(body.code || '').trim();
  if (!looksLikeEmail(email)) return res.status(400).json({ error: 'That does not look like an email address.' });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'The code is six digits.' });

  const phone = normalisePhone(body.phone);
  if (phone === null) return res.status(400).json({ error: 'That phone number does not look right.' });

  try {
    const checked = await checkCode(email, code);
    if (!checked.ok) return res.status(401).json({ error: checked.error });

    const user = await upsertUser({ email, phone: phone || undefined });
    if (!user) return res.status(500).json({ error: 'Could not open your account.' });

    // Bring across whatever this browser was already working on. A trip that
    // belongs to someone else is skipped rather than moved.
    for (const t of (Array.isArray(body.trips) ? body.trips : []).slice(0, 50)) {
      if (!t || typeof t.id !== 'string') continue;
      try { await claimTrip(user.id, t.id, String(t.label || '').slice(0, 120)); }
      catch (e) { /* one bad row must not fail the sign-in */ }
    }

    res.setHeader('set-cookie', cookieHeader(makeToken(user.id)));
    return res.status(200).json({
      user: { email: user.email, phone: user.phone || '' },
      trips: await listTrips(user.id),
    });
  } catch (err) {
    console.error('auth verify failed:', err);
    return res.status(500).json({ error: 'Could not sign you in. Try again.' });
  }
}
