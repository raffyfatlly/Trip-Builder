// Storage, and the fact that there almost isn't any.
//
// Everything else in this app is deliberately storage-free: people are told
// apart by an anonymous session id in their own browser, and the itinerary is
// replayed from the builder session's event log. That still holds. This file
// adds ONE thing on top — a list of which trips belong to which account — so a
// trip can be reached from a different phone.
//
// It stores no itineraries, no messages, no trip content. Just: this session
// id belongs to this person, and here is what to call it. Everything else
// still lives in the Anthropic session, exactly as before.
//
// Supabase over its REST API rather than the SDK: two env vars, no dependency,
// and the shapes stay visible. If those vars are missing the whole feature
// switches off and the app behaves exactly as it did before accounts existed.

const URL_ = () => process.env.SUPABASE_URL;
const KEY = () => process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

export const configured = () => !!(URL_() && KEY());

function headers(extra) {
  const key = KEY();
  return {
    apikey: key,
    authorization: 'Bearer ' + key,
    'content-type': 'application/json',
    ...extra,
  };
}

async function rest(path, init = {}) {
  if (!configured()) throw new Error('storage not configured');
  const res = await fetch(URL_() + '/rest/v1/' + path, {
    ...init,
    headers: headers(init.headers),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('db ' + res.status + ' ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

// --- which backend ---------------------------------------------------------
//
// Firestore if a service account is set, Supabase if its URL and key are, and
// otherwise nothing — in which case accounts simply do not appear and the app
// is exactly what it was before they existed.

import { firestoreConfigured, readAccount, writeAccount } from './firestore.js';

export const backend = () =>
  (firestoreConfigured() ? 'firestore' : (URL_() && KEY()) ? 'supabase' : null);

export const storeConfigured = () => !!backend();

// --- accounts, in the shape the app actually wants -------------------------
//
// One account is one document: who they are, and the trips they have. Nothing
// else is stored — no itineraries, no messages. Those still live in the
// Anthropic session and are replayed from its event log, as they always were.

export async function findOrCreate({ email, phone }) {
  if (backend() === 'firestore') {
    const existing = await readAccount(email);
    if (existing) {
      // A phone given later fills in a blank one, but never overwrites a number
      // already on file — that would let anyone typing this email replace it.
      if (phone && !existing.phone) return writeAccount({ ...existing, phone });
      return existing;
    }
    return writeAccount({ email, phone: phone || '', trips: [], memory: null });
  }
  return supaFindOrCreate({ email, phone });
}

export async function getAccount(email) {
  if (backend() === 'firestore') return readAccount(email);
  return supaGet(email);
}

// Merge rather than replace: the browser's list and the account's list are
// both real, and a trip must never be lost because it was only in one of them.
// The profile lives on the account so it follows them to another device.
export async function saveMemory(email, memory) {
  if (backend() === 'firestore') {
    const acct = (await readAccount(email)) || { email, phone: '', trips: [], memory: null };
    return writeAccount({ ...acct, memory: memory || null });
  }
  const rows = await rest('accounts?email=eq.' + encodeURIComponent(email), {
    method: 'PATCH', headers: { prefer: 'return=representation' },
    body: JSON.stringify({ memory: memory || null }),
  });
  const r = (rows || [])[0];
  return r ? { email: r.email, phone: r.phone || '', trips: r.trips || [], memory: r.memory || null } : null;
}

export async function saveTrips(email, trips) {
  const clean = [];
  const seen = new Set();
  for (const t of trips || []) {
    if (!t || typeof t.id !== 'string' || seen.has(t.id)) continue;
    seen.add(t.id);
    clean.push({ id: t.id, label: String(t.label || 'Untitled trip').slice(0, 120), at: Number(t.at) || Date.now() });
    if (clean.length >= 60) break;
  }
  clean.sort((a, b) => b.at - a.at);

  if (backend() === 'firestore') {
    const acct = (await readAccount(email)) || { email, phone: '', trips: [], memory: null };
    return writeAccount({ ...acct, trips: clean });
  }
  return supaSaveTrips(email, clean);
}

export const mergeTripLists = (a, b) => {
  const by = new Map();
  for (const t of [...(a || []), ...(b || [])]) {
    if (!t || !t.id) continue;
    const prev = by.get(t.id);
    // Newest wins on the label, oldest wins on the date the trip was started.
    if (!prev || (t.at || 0) > (prev.at || 0)) {
      by.set(t.id, { ...t, at: Math.max(t.at || 0, prev ? prev.at || 0 : 0) });
    }
  }
  return [...by.values()].sort((x, y) => (y.at || 0) - (x.at || 0));
};

// --- the Supabase path, kept as the alternative ---------------------------

async function supaFindOrCreate({ email, phone }) {
  const rows = await rest('accounts?on_conflict=email', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([{ email, phone: phone || '' }]),
  });
  const r = (rows || [])[0] || null;
  return r ? { email: r.email, phone: r.phone || '', trips: r.trips || [], memory: r.memory || null } : null;
}

async function supaGet(email) {
  const rows = await rest('accounts?email=eq.' + encodeURIComponent(email) + '&select=email,phone,trips,memory');
  const r = (rows || [])[0];
  return r ? { email: r.email, phone: r.phone || '', trips: r.trips || [] } : null;
}

async function supaSaveTrips(email, trips) {
  const rows = await rest('accounts?email=eq.' + encodeURIComponent(email), {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ trips }),
  });
  const r = (rows || [])[0];
  return r ? { email: r.email, phone: r.phone || '', trips: r.trips || [] } : null;
}

// If you would rather use Supabase than Firebase, this is the whole schema.
export const SCHEMA = `
create table if not exists accounts (
  email text primary key,
  phone text default '',
  trips jsonb not null default '[]'::jsonb,
  memory jsonb,
  created_at timestamptz not null default now()
);
alter table accounts enable row level security;
`;
