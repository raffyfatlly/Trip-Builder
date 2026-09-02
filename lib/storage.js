// Where a confirmation actually lives.
//
// raffy, 2026-09-02: "can we also put the link or button to open the file too?"
//
// It could not, and the reason is worth writing down: an uploaded file goes to
// the Anthropic Files API so the agent can read it, and that API answers
// `downloadable: false` for anything a person uploaded — only files a tool
// generated can be fetched back. So the model could read your booking PDF and
// the app could not give you a link to it. The bytes had to be kept somewhere
// of our own or the button was never going to exist.
//
// Cloud Storage, on the same service account that already holds Firestore. The
// bucket stays private: nothing is served from storage.googleapis.com directly,
// and the only way in is /api/doc, which checks the document belongs to the
// session asking for it. A confirmation email has somebody's full name, their
// address and their booking reference on it — a guessable public URL is not an
// acceptable place to keep that.

import crypto from 'crypto';
import { accessToken, projectId, firestoreConfigured } from './firestore.js';
import { fetchWith } from './net.js';

const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

// Firebase's default bucket, which changed name in 2024 — new projects get
// .firebasestorage.app and older ones kept .appspot.com. Neither is worth
// guessing wrong in production, so it can be set outright.
export const bucket = () =>
  process.env.FIREBASE_STORAGE_BUCKET
  || (projectId() ? projectId() + '.firebasestorage.app' : '');

export const storageConfigured = () => !!(firestoreConfigured() && bucket());

// Documents are namespaced by session, and the id carries no meaning — the
// path is not a capability, the session check is.
const key = (session, id) => 'docs/' + encodeURIComponent(session) + '/' + id;

export function newDocId() {
  return crypto.randomBytes(12).toString('hex');
}

// Stored with its own content type and filename so it comes back openable
// rather than as a blob the browser offers to download and cannot preview.
export async function putDoc(session, { id, name, type, bytes }) {
  if (!storageConfigured()) throw new Error('storage not configured');
  const docId = id || newDocId();
  const url = 'https://storage.googleapis.com/upload/storage/v1/b/'
    + encodeURIComponent(bucket()) + '/o?uploadType=media&name='
    + encodeURIComponent(key(session, docId));

  const r = await fetchWith(url, 60000, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + (await accessToken(SCOPE)),
      'content-type': type || 'application/octet-stream',
    },
    body: bytes,
  });
  if (!r.ok) throw new Error('put ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return { id: docId, name: name || 'confirmation', type: type || '', size: bytes.length };
}

// Returns { body, type } or null when there is no such document. Null rather
// than throwing: asking for a document that is not there is a 404, not a fault.
export async function getDoc(session, id) {
  if (!storageConfigured()) return null;
  if (!/^[a-f0-9]{16,32}$/.test(String(id || ''))) return null;
  const url = 'https://storage.googleapis.com/storage/v1/b/'
    + encodeURIComponent(bucket()) + '/o/'
    + encodeURIComponent(key(session, id)) + '?alt=media';

  const r = await fetchWith(url, 30000, {
    headers: { authorization: 'Bearer ' + (await accessToken(SCOPE)) },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('get ' + r.status);
  return {
    body: Buffer.from(await r.arrayBuffer()),
    type: r.headers.get('content-type') || 'application/octet-stream',
  };
}

// The link that goes on a booking card. Relative, because the app is served
// from more than one origin — localhost, a preview deployment, the real one —
// and a link that hardcodes any of them is broken on the other two.
export const docUrl = (session, id) =>
  '/api/doc?s=' + encodeURIComponent(session) + '&d=' + encodeURIComponent(id);

// Only used by the health check, which writes a probe object and must not
// leave it behind.
export async function dropDoc(session, id) {
  if (!storageConfigured()) return;
  const url = 'https://storage.googleapis.com/storage/v1/b/'
    + encodeURIComponent(bucket()) + '/o/' + encodeURIComponent(key(session, id));
  await fetchWith(url, 20000, {
    method: 'DELETE',
    headers: { authorization: 'Bearer ' + (await accessToken(SCOPE)) },
  });
}
