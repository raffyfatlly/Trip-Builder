// Create the account, or pick up the one that is already there. One step.

import {
  looksLikeEmail, normaliseEmail, normalisePhone, makeToken, cookieHeader,
} from '../../../lib/auth.js';
import { storeConfigured, findOrCreate, saveTrips, mergeTripLists } from '../../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!storeConfigured()) return res.status(501).json({ error: 'Accounts are not set up on this deployment.' });

  const body = req.body || {};
  const email = normaliseEmail(body.email);
  if (!looksLikeEmail(email)) return res.status(400).json({ error: 'That does not look like an email address.' });

  const phone = normalisePhone(body.phone);
  if (phone === null) return res.status(400).json({ error: 'That phone number does not look right.' });

  try {
    const account = await findOrCreate({ email, phone: phone || '' });
    if (!account) return res.status(500).json({ error: 'Could not open your account.' });

    // Whatever this browser was already working on joins the account rather
    // than being replaced by it.
    const merged = mergeTripLists(account.trips, Array.isArray(body.trips) ? body.trips : []);
    const saved = merged.length !== (account.trips || []).length || body.trips
      ? await saveTrips(email, merged)
      : account;

    res.setHeader('set-cookie', cookieHeader(makeToken(email)));
    return res.status(200).json({
      user: { email, phone: (saved && saved.phone) || phone || '' },
      trips: (saved && saved.trips) || merged,
    });
  } catch (err) {
    console.error('signin failed:', err);
    return res.status(500).json({ error: 'Could not open your account. Try again.' });
  }
}
