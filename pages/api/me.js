// Who is signed in here, and what are their trips.
//
// Also the write path: the browser posts a trip it has just named, and it
// joins the account. Anonymous browsers get {user:null} and carry on exactly
// as they did before accounts existed.

import { userFrom, normalisePhone } from '../../lib/auth.js';
import { storeConfigured, getAccount, saveTrips, saveMemory, mergeTripLists, findOrCreate } from '../../lib/db.js';
import { claimOwner, firestoreConfigured } from '../../lib/firestore.js';

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
      // A claim is only good if nobody else already owns that session.
      //
      // raffy, 2026-09-07: "I use her phone, log out, then sign in again
      // suddenly her session is saved on my account." This accepted any
      // session id the browser was holding, so the trip followed the phone
      // rather than the person who made it. The browser posts its claim on
      // every load, which is why this has to treat "already mine" as an
      // ordinary success and only refuse a claim on somebody ELSE's trip.
      if (body.claim && typeof body.claim.id === 'string') {
        const owner = firestoreConfigured() ? await claimOwner(body.claim.id, email) : null;
        if (owner && owner.who && owner.who !== email) {
          // Not an error the person needs to see — their browser simply still
          // had the previous account's session in it. Say so and change
          // nothing, rather than half-adding a trip they cannot open.
          return res.status(200).json({
            accounts: true,
            user: { email: account.email, phone: account.phone || '' },
            trips: account.trips || [],
            memory: account.memory || null,
            claimRefused: 'that trip belongs to another account',
          });
        }
        account = await saveTrips(email, mergeTripLists(account.trips, [{
          id: body.claim.id, label: body.claim.label, at: Date.now(),
        }]));
      }
      if (body.memory !== undefined) account = await saveMemory(email, body.memory);
      if (typeof body.forget === 'string') {
        account = await saveTrips(email, (account.trips || []).filter((t) => t.id !== body.forget));
      }
    }

    return res.status(200).json({
      accounts: true,
      user: { email: account.email, phone: account.phone || '' },
      trips: account.trips || [],
      memory: account.memory || null,
    });
  } catch (err) {
    console.error('me failed:', err);
    return res.status(500).json({ error: 'Could not read your account.' });
  }
}
