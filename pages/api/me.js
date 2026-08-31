// Who is signed in here, and what are their trips.
//
// Also the write path: the browser posts a trip it has just named, and it
// joins the account. Anonymous browsers get {user:null} and carry on exactly
// as they did before accounts existed.

import { userFrom, normalisePhone } from '../../lib/auth.js';
import { storeConfigured, getAccount, saveTrips, mergeTripLists, findOrCreate } from '../../lib/db.js';

export default async function handler(req, res) {
  if (!storeConfigured()) return res.status(200).json({ user: null, accounts: false });

  // The cookie carries the email, which is the account key.
  const email = userFrom(req);
  if (!email) return res.status(200).json({ user: null, accounts: true });

  try {
    let account = await getAccount(email);
    if (!account) return res.status(200).json({ user: null, accounts: true });

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.phone !== undefined) {
        const phone = normalisePhone(body.phone);
        if (phone === null) return res.status(400).json({ error: 'That phone number does not look right.' });
        account = await findOrCreate({ email, phone });
      }
      if (body.claim && typeof body.claim.id === 'string') {
        account = await saveTrips(email, mergeTripLists(account.trips, [{
          id: body.claim.id, label: body.claim.label, at: Date.now(),
        }]));
      }
      if (typeof body.forget === 'string') {
        account = await saveTrips(email, (account.trips || []).filter((t) => t.id !== body.forget));
      }
    }

    return res.status(200).json({
      accounts: true,
      user: { email: account.email, phone: account.phone || '' },
      trips: account.trips || [],
    });
  } catch (err) {
    console.error('me failed:', err);
    return res.status(500).json({ error: 'Could not read your account.' });
  }
}
