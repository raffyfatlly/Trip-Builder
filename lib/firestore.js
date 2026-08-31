// Firestore over its REST API, with no SDK.
//
// raffy, 2026-08-31: "I need something that u can have direct access too. not
// me having to login anywhere."
//
// There is no zero-credential option — I checked. Managed Agents sessions
// start a billed model turn on every write, and files uploaded to the Files
// API cannot be read back. So one credential is the floor, and this is the
// cheapest one to hand over: a service account JSON, pasted into a single
// environment variable. No schema to create, no SQL to run, no dashboard to
// come back to. Firestore makes the collections on first write.
//
// Auth is the standard service-account flow: sign a JWT with the private key,
// swap it for an access token, cache the token until it is nearly expired.

import crypto from 'crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';

let cached = null;   // { token, expires }

function creds() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    // Accept the JSON as-is or base64-encoded, because pasting a multi-line
    // private key into an environment variable goes wrong in both directions.
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString();
    const j = JSON.parse(text);
    if (!j.client_email || !j.private_key || !j.project_id) return null;
    return { ...j, private_key: j.private_key.replace(/\\n/g, '\n') };
  } catch (e) {
    return null;
  }
}

export const firestoreConfigured = () => !!creds();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function accessToken() {
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  const c = creds();
  if (!c) throw new Error('no service account');

  const now = Math.floor(Date.now() / 1000);
  const claim = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: c.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  });
  const sig = crypto.createSign('RSA-SHA256').update(claim).sign(c.private_key, 'base64url');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: claim + '.' + sig,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error('token ' + res.status + ' ' + JSON.stringify(data).slice(0, 200));
  }
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return cached.token;
}

const base = () =>
  'https://firestore.googleapis.com/v1/projects/' + creds().project_id +
  '/databases/(default)/documents';

async function call(path, init = {}) {
  const res = await fetch(base() + path, {
    ...init,
    headers: { authorization: 'Bearer ' + (await accessToken()), 'content-type': 'application/json', ...init.headers },
  });
  const text = await res.text();
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('firestore ' + res.status + ' ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

// --- Firestore's typed values, in and out --------------------------------
//
// Everything is wrapped: {stringValue}, {arrayValue:{values:[...]}}. Kept to
// the three shapes actually used rather than a general encoder, so a wrong
// shape shows up here rather than as a silent empty field.

const enc = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'number') return { integerValue: String(Math.round(v)) };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === 'object') return { mapValue: { fields: encFields(v) } };
  return { stringValue: String(v) };
};
const encFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));

const dec = (v) => {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decFields(v.mapValue.fields || {});
  return null;
};
const decFields = (f) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, dec(v)]));

// --- the two things this app stores --------------------------------------
//
// One document per account, keyed by the email itself. That makes "find this
// person" a direct read rather than a query, so there is no index to create
// and nothing to configure — which is the whole point of choosing this.

const docId = (email) =>
  crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex').slice(0, 32);

export async function readAccount(email) {
  const doc = await call('/accounts/' + docId(email));
  if (!doc) return null;
  const f = decFields(doc.fields);
  return { id: docId(email), email: f.email || email, phone: f.phone || '', trips: f.trips || [], memory: f.memory || null };
}

export async function writeAccount(account) {
  const id = docId(account.email);
  // The mask names every field we write, so a PATCH replaces them outright
  // instead of merging a shortened trip list into the old longer one.
  const mask = ['email', 'phone', 'trips', 'memory'].map((f) => 'updateMask.fieldPaths=' + f).join('&');
  await call('/accounts/' + id + '?' + mask, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: encFields({
        email: account.email,
        phone: account.phone || '',
        trips: (account.trips || []).map((t) => ({
          id: String(t.id), label: String(t.label || ''), at: Number(t.at) || Date.now(),
        })),
        memory: account.memory || null,
      }),
    }),
  });
  return { ...account, id };
}

export const _internals = { enc, dec, encFields, decFields, docId };

// --- builds ---------------------------------------------------------------
//
// A build outlives a serverless function, so its conversation is parked here
// between polls. Same idea as the Managed Agents event log it replaces: each
// poll reads where things got to, advances them a little, writes back.

export async function readBuild(id) {
  const doc = await call('/builds/' + encodeURIComponent(id));
  if (!doc) return null;
  const f = decFields(doc.fields);
  let messages = [];
  try { messages = JSON.parse(f.messages || '[]'); } catch (e) { messages = []; }
  let itinerary = null;
  try { itinerary = f.itinerary ? JSON.parse(f.itinerary) : null; } catch (e) { itinerary = null; }
  return { messages, itinerary, steps: f.steps || 0, done: !!f.done, error: f.error || '' };
}

export async function writeBuild(id, b) {
  const mask = ['messages', 'itinerary', 'steps', 'done', 'error']
    .map((f) => 'updateMask.fieldPaths=' + f).join('&');
  await call('/builds/' + encodeURIComponent(id) + '?' + mask, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        // Stored as JSON strings, not Firestore maps: the message list is
        // deeply nested and arbitrary, and Firestore rejects nested arrays.
        messages: { stringValue: JSON.stringify(b.messages || []) },
        itinerary: { stringValue: b.itinerary ? JSON.stringify(b.itinerary) : '' },
        steps: { integerValue: String(b.steps || 0) },
        done: { booleanValue: !!b.done },
        error: { stringValue: b.error || '' },
      },
    }),
  });
}
