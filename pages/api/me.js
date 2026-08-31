// Who is signed in here, and what are their trips.
//
// Also the write path: the browser posts a trip it has just named, and it is
// attached to the account. Anonymous browsers get {user:null} and carry on
// exactly as they did before accounts existed.

import { userFrom, authConfigured } from '../../lib/auth.js';
import { configured, getUser, listTrips, claimTrip, dropTrip, setPhone } from '../../lib/db.js';
import { normalisePhone } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (!authConfigured() || !configured()) return res.status(200).json({ user: null, accounts: false });

  const userId = userFrom(req);
  if (!userId) return res.status(200).json({ user: null, accounts: true });

  try {
    const user = await getUser(userId);
    if (!user) return res.status(200).json({ user: null, accounts: true });

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.phone !== undefined) {
        const phone = normalisePhone(body.phone);
        if (phone === null) return res.status(400).json({ error: 'That phone number does not look right.' });
        await setPhone(userId, phone);
      }
      if (body.claim && typeof body.claim.id === 'string') {
        await claimTrip(userId, body.claim.id, String(body.claim.label || '').slice(0, 120));
      }
      if (typeof body.forget === 'string') await dropTrip(userId, body.forget);
    }

    return res.status(200).json({
      accounts: true,
      user: { email: user.email, phone: user.phone || '' },
      trips: await listTrips(userId),
    });
  } catch (err) {
    console.error('me failed:', err);
    return res.status(500).json({ error: 'Could not read your account.' });
  }
}
