// Create the account, or pick up the one that is already there. One step.

import {
  looksLikeEmail, normaliseEmail, normalisePhone, makeToken, cookieHeader,
} from '../../../lib/auth.js';
import { storeConfigured, findOrCreate, saveTrips, mergeTripLists } from '../../../lib/db.js';
import { readOwner, mayOpen, claimOwner, firestoreConfigured } from '../../../lib/firestore.js';

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

    // Whatever this browser was already working on joins the account — but
    // only the parts that are actually theirs to take.
    //
    // raffy, 2026-09-07: "make sure if switching account on same device only
    // bring session from account don't mix it or overwrite."
    //
    // This used to merge the browser's whole trip list into whichever account
    // signed in. Sign in as somebody else on a shared phone and the previous
    // person's trips were written into YOUR account, server-side and
    // permanently — the same failure as the session claim, one level up.
    //
    // A trip qualifies if nobody owns it (anonymous work this person just did,
    // which is the case worth carrying) or if they already own it or are a
    // guest on it. Anything else belongs to somebody else and is left alone.
    const offered = Array.isArray(body.trips) ? body.trips.slice(0, 20) : [];
    let mine = offered;
    if (firestoreConfigured() && offered.length) {
      const checked = await Promise.all(offered.map(async (t) => {
        try {
          const owner = await readOwner(t && t.id);
          if (!mayOpen(owner, email)) return null;
          // Unowned and now carried into an account: record who owns it, or
          // the next person to sign in on this device can take it too.
          if (!owner || !owner.who) await claimOwner(t.id, email);
          return t;
        } catch (e) {
          // Unknowable ownership is not a reason to hand it over.
          return null;
        }
      }));
      mine = checked.filter(Boolean);
    }
    const merged = mergeTripLists(account.trips, mine);
    const saved = merged.length !== (account.trips || []).length || mine.length
      ? await saveTrips(email, merged)
      : account;

    res.setHeader('set-cookie', cookieHeader(makeToken(email)));
    return res.status(200).json({
      user: { email, phone: (saved && saved.phone) || phone || '' },
      trips: (saved && saved.trips) || merged,
      memory: (saved && saved.memory) || account.memory || null,
    });
  } catch (err) {
    console.error('signin failed:', err);
    return res.status(500).json({ error: 'Could not open your account. Try again.' });
  }
}
