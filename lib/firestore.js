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
import { fetchWith } from './net.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';

const cached = new Map();   // scope -> { token, expires }

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

// One service account, more than one Google API. Firestore holds the trips and
// Cloud Storage holds the confirmations people send in, and a token is minted
// per scope rather than per call — asking for both scopes at once would hand
// every Firestore read the right to write files.
export async function accessToken(scope = SCOPE) {
  const hit = cached.get(scope);
  if (hit && hit.expires > Date.now() + 60000) return hit.token;
  const c = creds();
  if (!c) throw new Error('no service account');

  const now = Math.floor(Date.now() / 1000);
  const claim = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: c.client_email, scope, aud: TOKEN_URL, iat: now, exp: now + 3600,
  });
  const sig = crypto.createSign('RSA-SHA256').update(claim).sign(c.private_key, 'base64url');

  const res = await fetchWith(TOKEN_URL, 15000, {
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
  const tok = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  cached.set(scope, tok);
  return tok.token;
}

// The project the service account belongs to, for anything that has to name it.
export const projectId = () => (creds() || {}).project_id || '';

const base = () =>
  'https://firestore.googleapis.com/v1/projects/' + creds().project_id +
  '/databases/(default)/documents';

async function call(path, init = {}) {
  const res = await fetchWith(base() + path, 15000, {
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

// --- runtime config --------------------------------------------------------
//
// raffy, 2026-09-02: "don't ask me to put in env. for now just put it where it
// works."
//
// A credential cannot go in the code — this repo is public, and unlike an
// affiliate marker an API token can read and spend. But it does not have to go
// in a dashboard either. It goes here: server-side, written with the service
// account we already hold, read at runtime, never shipped to a browser and
// never in a diff. One document, so setting a key is a write rather than an
// errand for him.
//
// The environment still wins where it is set, so nothing here overrides a
// deliberate deployment setting.

export async function readConfig() {
  const doc = await call('/config/app');
  if (!doc) return {};
  const f = decFields(doc.fields);
  try { return JSON.parse(f.values || '{}'); } catch (e) { return {}; }
}

export async function writeConfig(patch) {
  const now = { ...(await readConfig()), ...(patch || {}) };
  for (const k of Object.keys(now)) if (now[k] === '' || now[k] == null) delete now[k];
  await call('/config/app?updateMask.fieldPaths=values', {
    method: 'PATCH',
    body: JSON.stringify({ fields: { values: enc(JSON.stringify(now)) } }),
  });
  return now;
}

// --- filled photos ---------------------------------------------------------
//
// Pictures the app looked up itself for places the builder left blank. They
// cost a billed Places call each, so they are paid for ONCE and kept: a poll
// must never be able to spend money, and a rebuild must not re-buy a photo of
// a hotel that has not changed.
//
// Keyed by the normalised place NAME rather than by position, for the same
// reason the rebuild re-attach is: a rebuild is exactly when things move.

export async function readFill(session) {
  const doc = await call('/fills/' + encodeURIComponent(session));
  if (!doc) return {};
  const f = decFields(doc.fields);
  try { return JSON.parse(f.photos || '{}'); } catch (e) { return {}; }
}

export async function writeFill(session, photos) {
  await call('/fills/' + encodeURIComponent(session) + '?updateMask.fieldPaths=photos', {
    method: 'PATCH',
    body: JSON.stringify({ fields: { photos: enc(JSON.stringify(photos || {})) } }),
  });
}

// --- the credit ledger -----------------------------------------------------
//
// Its own document rather than a field on the account, for two reasons that
// have both already caused a bug in this file's history: writeAccount() names
// every field it writes in an update mask, so a balance living there would be
// wiped by any code path that saved a trip list without knowing about credits;
// and the trip list and the balance are written by different requests at
// different times, so sharing a document means one silently losing the other.

export async function readLedger(id) {
  const doc = await call('/ledger/' + encodeURIComponent(id));
  if (!doc) return null;
  const f = decFields(doc.fields);
  return { id, granted: Number(f.granted) || 0, used: Number(f.used) || 0, since: f.since || '' };
}

export async function writeLedger(l) {
  const mask = ['granted', 'used', 'since'].map((f) => 'updateMask.fieldPaths=' + f).join('&');
  await call('/ledger/' + encodeURIComponent(l.id) + '?' + mask, {
    method: 'PATCH',
    body: JSON.stringify({ fields: encFields({
      granted: Math.round(l.granted || 0),
      used: Math.round(l.used || 0),
      since: l.since || new Date().toISOString(),
    }) }),
  });
  return { ...l };
}

export async function listLedgers(limit = 200) {
  const d = await call('/ledger?pageSize=' + limit);
  return ((d && d.documents) || []).map((doc) => {
    const f = decFields(doc.fields);
    return {
      id: decodeURIComponent(String(doc.name).split('/').pop()),
      granted: Number(f.granted) || 0, used: Number(f.used) || 0, since: f.since || '',
    };
  });
}

// --- the place cache -------------------------------------------------------
//
// raffy, 2026-09-05, after being shown the bill: "do something about the google
// services api to drive the cost down."
//
// Places text search is the single most expensive service in the app — 44 calls
// and $1.41 on one Chiang Mai trip, against $0.57 to build the whole itinerary.
// Most of those calls are the same handful of places asked for more than once:
// the chat looks up Wat Phra Singh for its hours, travel_time looks it up again
// for its coordinates, and the builder looks it up a third time for a photo.
//
// lib/photos.js already had a Map for this, which is right and dies with the
// lambda. This is the same cache with a floor under it: one document per
// normalised query, shared by every session and every serverless invocation, so
// the second person to plan Chiang Mai pays nothing to find the temples.
//
// Thirty days, because that is Google's own cache limit for Places content.
// Nothing here is served to a browser directly — it is the same answer the API
// would give, held for the length Google allows and no longer.

const PLACE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// The document id has to survive being a path segment, and a raw query is full
// of slashes and spaces. A hash of the normalised query is stable, short, and
// makes "Wat Phra Singh, Chiang Mai" and "Wat Phra Singh Chiang Mai" the same
// document — see placeKey() in lib/placecache.js for why that matters.
const placeDoc = (key) =>
  crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 32);

export async function readPlace(key) {
  const doc = await call('/places/' + placeDoc(key));
  if (!doc) return null;
  const f = decFields(doc.fields);
  if (!f.t || Date.now() - Number(f.t) > PLACE_TTL_MS) return null;
  // `value` is the JSON of a lookup that found nothing as readily as one that
  // did. A miss is worth caching — a place Google has never heard of will not
  // start existing this month, and re-asking is the half that costs money.
  try { return { hit: true, value: JSON.parse(f.value || 'null') }; }
  catch (e) { return null; }
}

export async function writePlace(key, value) {
  await call('/places/' + placeDoc(key) + '?updateMask.fieldPaths=value&updateMask.fieldPaths=t&updateMask.fieldPaths=q', {
    method: 'PATCH',
    body: JSON.stringify({ fields: {
      value: enc(JSON.stringify(value === undefined ? null : value)),
      t: enc(Date.now()),
      // Kept only so the collection is readable by a human wondering what is in
      // it. Nothing reads this field.
      q: enc(String(key).slice(0, 200)),
    } }),
  });
}

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
  return { messages, itinerary, steps: f.steps || 0, done: !!f.done, error: f.error || '',
    empty: f.empty || 0 };
}

export async function writeBuild(id, b) {
  // `empty` counts consecutive replies with nothing in them. It has to survive
  // between polls or the count resets every time and a builder that has stopped
  // answering is retried until the step ceiling — which is what happened.
  const mask = ['messages', 'itinerary', 'steps', 'done', 'error', 'empty']
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
        empty: { integerValue: String(b.empty || 0) },
      },
    }),
  });
}

// --- the beta journal ------------------------------------------------------
//
// What each session did and what it cost. One document per session, stored as
// a JSON string for the same reason builds are: the timeline is a list of
// arbitrarily-shaped rows and Firestore rejects nested arrays.
//
// See lib/journal.js for the rules. Nothing here may throw into a request.

export async function journalRead(session) {
  const doc = await call('/journal/' + encodeURIComponent(session));
  if (!doc) return null;
  const f = decFields(doc.fields);
  try { return JSON.parse(f.body || 'null'); } catch (e) { return null; }
}

export async function journalWrite(session, j) {
  const mask = ['body', 'usd', 'last'].map((x) => 'updateMask.fieldPaths=' + x).join('&');
  await call('/journal/' + encodeURIComponent(session) + '?' + mask, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        body: { stringValue: JSON.stringify(j) },
        // Duplicated out of the blob so a listing can sort and total without
        // parsing every session's whole timeline.
        usd: { doubleValue: Object.keys(j.spend || {})
          .reduce((a, k) => a + ((j.spend[k] || {}).usd || 0), 0) },
        last: { stringValue: j.last || '' },
      },
    }),
  });
}

// Scrub one session's record. Used when a test or a mistake writes a row into
// the same collection the beta figures are read from — which has happened, and
// silently skewed a cost average until somebody noticed.
export async function journalDelete(session) {
  await call('/journal/' + encodeURIComponent(session), { method: 'DELETE' });
}

// Newest first. pageSize is generous because a beta is tens of sessions, not
// thousands; when that stops being true this wants a real query with an index.
export async function journalList(limit = 200) {
  const d = await call('/journal?pageSize=' + Math.min(limit, 300));
  const out = [];
  for (const doc of (d && d.documents) || []) {
    const f = decFields(doc.fields);
    let body = null;
    try { body = JSON.parse(f.body || 'null'); } catch (e) { body = null; }
    if (body) out.push(body);
  }
  out.sort((a, b) => String(b.last || '').localeCompare(String(a.last || '')));
  return out.slice(0, limit);
}
