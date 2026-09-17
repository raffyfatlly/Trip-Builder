// Sharing one real answer from the landing page's ask box, the same shape
// as sharing a trip (lib/share.js) — a random token that maps to content,
// minted server-side only.
//
// raffy, 2026-09-17: "i want to copy people question from Facebook. and
// paste it in the landing page. then i want to share the real answer it
// give in the form of visual link... cause nowdays people won't just click
// some random link. especially if I don't give value." So the token is
// minted the moment a real answer comes back from lib/hook.js — there is no
// separate public endpoint that accepts arbitrary text, on purpose: this
// deployment's own brand should never be able to say something it did not
// actually generate.

import { randomBytes } from 'crypto';
import { firestoreConfigured, readAnswerShare, writeAnswerShare } from './firestore.js';

const NEW = () => randomBytes(17).toString('base64url').slice(0, 22);

export const answerShareReady = () => firestoreConfigured();

/** Save a real answer under a fresh token. Never throws — a share link is a
 * bonus on top of the answer, not something worth failing the answer for. */
export async function makeAnswerShare(question, answer) {
  if (!answerShareReady() || !question || !answer) return '';
  try {
    const token = NEW();
    await writeAnswerShare(token, question, answer);
    return token;
  } catch (err) {
    return '';
  }
}

/** What a share link opens, if it still exists. */
export async function getAnswerShare(token) {
  if (!answerShareReady() || !/^[A-Za-z0-9_-]{22}$/.test(String(token || ''))) return null;
  try {
    return await readAnswerShare(token);
  } catch (err) {
    return null;
  }
}
