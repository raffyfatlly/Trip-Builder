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
// .firebasestorage.app and older ones kept .appspot.com.
//
// This guessed `.firebasestorage.app` and guessed wrong: production answered
// "The specified bucket does not exist" on every write, so every booking
// confirmation anybody uploaded failed. Guessing the OTHER suffix would just be
// a second guess, and the project might have a bucket named neither.
//
// So ask. Google will list the project's buckets for the same service account
// that is already reading Firestore, and the answer is authoritative. The name
// is still settable outright — an explicit env var always wins and skips the
// lookup entirely.
export const bucket = () =>
  process.env.FIREBASE_STORAGE_BUCKET
  || RESOLVED
  || (projectId() ? projectId() + '.firebasestorage.app' : '');

// What the lookup found, once per warm lambda. Deliberately a module-level
// value rather than something threaded through: `bucket()` is called from URL
// building in three places and making all of them async to pass a string around
// would be worse than this.
let RESOLVED = '';
let LOOKUP = null;

/** Every bucket this project actually has. */
export async function listBuckets() {
  if (!firestoreConfigured() || !projectId()) return [];
  const r = await fetchWith(
    'https://storage.googleapis.com/storage/v1/b?project=' + encodeURIComponent(projectId()),
    20000, { headers: { authorization: 'Bearer ' + (await accessToken(SCOPE)) } });
  if (!r.ok) return [];
  const j = await r.json();
  return ((j && j.items) || []).map((b) => b.name).filter(Boolean);
}

/**
 * Create the project's default bucket.
 *
 * The lookup above answered the question the guessing never could: the project
 * has no storage bucket AT ALL. Firebase Storage was never switched on, so
 * every booking confirmation anybody uploaded had nowhere to go.
 *
 * Deliberately narrow. It takes no name — it can only ever create
 * `<project>.firebasestorage.app`, the Firebase default — so this cannot be
 * used to make arbitrary buckets in his project. It refuses if any bucket
 * already exists, so it cannot clobber one.
 *
 * asia-southeast1 (Singapore) rather than the US default: the people using this
 * are in Malaysia, and a confirmation they upload should not cross the Pacific
 * twice. Uniform access and private — nothing here is served from
 * storage.googleapis.com directly, the app proxies every read after checking
 * the session.
 */
export async function createBucket(location = 'asia-southeast1') {
  if (!firestoreConfigured() || !projectId()) return { error: 'no project' };
  const existing = await listBuckets();
  if (existing.length) return { error: 'the project already has: ' + existing.join(', ') };
  const name = projectId() + '.firebasestorage.app';
  const r = await fetchWith(
    'https://storage.googleapis.com/storage/v1/b?project=' + encodeURIComponent(projectId()),
    30000,
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + (await accessToken(SCOPE)),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name,
        location,
        storageClass: 'STANDARD',
        iamConfiguration: {
          uniformBucketLevelAccess: { enabled: true },
          publicAccessPrevention: 'enforced',
        },
      }),
    });
  const text = await r.text();
  if (!r.ok) return { error: r.status + ' ' + text.slice(0, 300) };
  RESOLVED = name;
  LOOKUP = null;
  return { created: name, location };
}

/**
 * Settle on a bucket that exists, once.
 *
 * Preference order matters: a project can have several buckets — Firebase's
 * default plus whatever else was created — and picking the wrong one would
 * write confirmations somewhere nobody reads them. Both Firebase default names
 * come first, and only then anything else, which is a last resort rather than
 * an equal option.
 */
export async function resolveBucket() {
  if (process.env.FIREBASE_STORAGE_BUCKET) return process.env.FIREBASE_STORAGE_BUCKET;
  if (RESOLVED) return RESOLVED;
  if (!LOOKUP) {
    LOOKUP = (async () => {
      try {
        const all = await listBuckets();
        const p = projectId();
        RESOLVED = all.find((b) => b === p + '.firebasestorage.app')
          || all.find((b) => b === p + '.appspot.com')
          || all[0] || '';
        return RESOLVED;
      } catch (err) {
        return '';
      }
    })();
  }
  return LOOKUP;
}

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
  // Say what is actually wrong rather than letting a guessed bucket name 404.
  // On this project the honest answer is that there is no bucket, because Cloud
  // Storage needs a billing account and the project has none — so every upload
  // was paying for a round trip to find that out again.
  if (!(await resolveBucket())) {
    throw new Error('the project has no storage bucket (Cloud Storage needs billing enabled)');
  }
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
  await resolveBucket();
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
  await resolveBucket();
  const url = 'https://storage.googleapis.com/storage/v1/b/'
    + encodeURIComponent(bucket()) + '/o/' + encodeURIComponent(key(session, id));
  await fetchWith(url, 20000, {
    method: 'DELETE',
    headers: { authorization: 'Bearer ' + (await accessToken(SCOPE)) },
  });
}
