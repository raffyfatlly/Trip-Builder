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

// --- accounts -------------------------------------------------------------

export async function upsertUser({ email, phone }) {
  const rows = await rest('users?on_conflict=email', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([{ email, ...(phone ? { phone } : {}) }]),
  });
  return (rows || [])[0] || null;
}

export async function setPhone(userId, phone) {
  const rows = await rest('users?id=eq.' + encodeURIComponent(userId), {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ phone }),
  });
  return (rows || [])[0] || null;
}

export async function getUser(userId) {
  const rows = await rest('users?id=eq.' + encodeURIComponent(userId) + '&select=id,email,phone');
  return (rows || [])[0] || null;
}

// --- trips ----------------------------------------------------------------

// Claiming is idempotent and never steals: a session already claimed by
// somebody else stays theirs. Two people cannot end up fighting over one trip
// because a session id was pasted into the wrong browser.
export async function claimTrip(userId, sessionId, label) {
  const existing = await rest(
    'trips?session_id=eq.' + encodeURIComponent(sessionId) + '&select=session_id,user_id');
  const owner = (existing || [])[0];

  if (owner && owner.user_id !== userId) return { claimed: false, reason: 'belongs to another account' };

  if (owner) {
    await rest('trips?session_id=eq.' + encodeURIComponent(sessionId), {
      method: 'PATCH',
      body: JSON.stringify({ label, updated_at: new Date().toISOString() }),
    });
    return { claimed: true };
  }

  await rest('trips', {
    method: 'POST',
    body: JSON.stringify([{ session_id: sessionId, user_id: userId, label }]),
  });
  return { claimed: true };
}

export async function listTrips(userId) {
  const rows = await rest(
    'trips?user_id=eq.' + encodeURIComponent(userId) +
    '&select=session_id,label,created_at,updated_at&order=updated_at.desc&limit=50');
  return (rows || []).map((r) => ({
    id: r.session_id,
    label: r.label || 'Untitled trip',
    at: new Date(r.updated_at || r.created_at).getTime(),
  }));
}

export async function dropTrip(userId, sessionId) {
  await rest('trips?user_id=eq.' + encodeURIComponent(userId) +
             '&session_id=eq.' + encodeURIComponent(sessionId), { method: 'DELETE' });
}

// The SQL to create what this file expects. Kept next to the queries so the
// two cannot drift apart.
export const SCHEMA = `
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists trips (
  session_id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trips_user_idx on trips(user_id, updated_at desc);

-- Every query here goes through the service key on the server, and the
-- browser never talks to the database directly. RLS on with no policies means
-- a leaked anon key still reads nothing.
alter table users enable row level security;
alter table trips enable row level security;
`;
