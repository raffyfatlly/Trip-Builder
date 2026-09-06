// Sharing a trip with the people going on it.
//
// raffy, 2026-09-06: "i want to explore the idea of sharing their itenary to
// people... and also that perhaps open the path for future collaborative
// planning."
//
// A LINK, not a file. A PDF of a trip is wrong the moment a hotel changes; a
// link is the same trip, always current — and it is the only shape that can
// become collaboration later, which is the actual prize.
//
// Three things it must not be:
//
//   NOT the session id. /t/<session> already works, but a session id is the
//   key to the whole conversation: the chat, the credits, the ability to send
//   messages as them. Handing that to a group chat is handing over the account.
//   A share is a separate, meaningless token that maps to the session here and
//   nowhere else.
//
//   NOT permanent. Its own Firestore row, so revoking is a delete and the link
//   dies immediately, rather than a flag somebody has to remember to check.
//
//   NOT editable. A viewer sees the trip; they cannot change it. See the
//   readOnly path in renderer/render.js.

import { randomBytes } from 'crypto';
import { firestoreConfigured, readShare, writeShare, dropShare } from './firestore.js';

// Long enough that guessing is pointless, short enough to survive being pasted
// into WhatsApp without wrapping. 22 chars of base64url is 132 bits.
const NEW = () => randomBytes(17).toString('base64url').slice(0, 22);

export const shareReady = () => firestoreConfigured();

/** A token is what a share link carries. Sessions are `sesn_…` and never this. */
export const looksLikeToken = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{22}$/.test(s);

/** Mint a link for this session. Fresh every time it is asked for. */
export async function makeShare(session) {
  if (!shareReady() || !session) return null;
  const token = NEW();
  await writeShare(token, session);
  return token;
}

/** Which session does this token open, if any. */
export async function shareSession(token) {
  if (!shareReady() || !looksLikeToken(token)) return '';
  const row = await readShare(token);
  return (row && row.session) || '';
}

/** Kill a link. The trip is untouched; only the way in goes. */
export async function revokeShare(token) {
  if (!shareReady() || !looksLikeToken(token)) return false;
  await dropShare(token);
  return true;
}
