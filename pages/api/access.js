// Who else can open this trip.
//
// raffy, 2026-09-07: "user can share a specific session with other user. and
// built a good mechanism to allow this and allow the value of the app to
// increase."
//
// This is NOT the share link. That one (lib/share.js) mints a revocable token
// anybody can read, and read is all they get. This is the other half: a named
// person, with an account, who can open the trip in their own app and change
// it — planning together rather than being shown a copy.
//
// Two rules make it worth having, and both were decisions raffy took:
//
//   INVITED BY EMAIL, not by a link anyone can forward. The owner knows exactly
//   who is in, and can take one person back out without disturbing the rest.
//
//   EACH PERSON PAYS FOR THEIR OWN TURNS. A guest spends their own credits, so
//   inviting four people cannot empty the owner's balance and a guest cannot
//   spend somebody else's money by typing. It also means a guest needs an
//   account, which is the growth in it: sharing a trip turns one user into
//   several instead of costing the first one more.

import { userFrom } from '../../lib/auth.js';
import { readOwner, setGuest, firestoreConfigured } from '../../lib/firestore.js';

export default async function handler(req, res) {
  if (!firestoreConfigured()) return res.status(501).json({ error: 'no store configured' });

  const me = userFrom(req);
  if (!me) return res.status(401).json({ error: 'Sign in first.' });

  const session = String((req.query && req.query.s) || (req.body && req.body.session) || '');
  if (!session) return res.status(400).json({ error: 'session required' });

  try {
    const owner = await readOwner(session);
    if (!owner || !owner.who) {
      return res.status(404).json({ error: 'That trip has no owner yet.' });
    }
    const mine = String(owner.who).toLowerCase() === String(me).toLowerCase();

    if (req.method === 'GET') {
      // A guest may see that they are on the list, but not the rest of it —
      // who else the owner invited is the owner's business.
      if (mine) return res.status(200).json({ owner: owner.who, guests: owner.guests || [], mine: true });
      const isGuest = (owner.guests || []).some((g) => String(g).toLowerCase() === String(me).toLowerCase());
      if (!isGuest) return res.status(403).json({ error: 'That is not your trip.' });
      return res.status(200).json({ owner: owner.who, guests: [], mine: false });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' });

    const body = req.body || {};
    const invited = body.invite !== undefined;
    const email = String(invited ? body.invite : body.revoke || '');
    // setGuest does the owner check itself rather than trusting this route to
    // have done it — one place to get it right, and a second caller later
    // cannot skip it.
    const out = await setGuest(session, me, email, invited);
    if (out.error) return res.status(403).json({ error: out.error });

    return res.status(200).json({ owner: out.who, guests: out.guests, mine: true });
  } catch (err) {
    console.error('access failed:', err);
    return res.status(500).json({ error: 'Could not change who can see this trip.' });
  }
}
