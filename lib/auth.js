// Signing in, kept as light as it can be while still meaning something.
//
// raffy, 2026-08-31: "there's no need to high verification level or anything.
// like fon number email is good."
//
// So: no passwords, no OAuth, no identity checks. You type your email, you get
// a six digit code, you are in. What that buys — and the reason it is a code
// rather than just typing an address — is that your trips are not readable by
// anyone who can guess your email address. That is not "high verification", it
// is the floor.
//
// Phone is stored on the profile, not used to sign in: phone codes need a
// paid SMS provider, and email costs nothing.
//
// The code itself is sent by Supabase Auth, so there is no mail server to run.
// The session afterwards is our own signed cookie rather than a Supabase JWT —
// one less moving part, and it can be verified without a network call.

import crypto from 'crypto';

const URL_ = () => process.env.SUPABASE_URL;
const ANON = () => process.env.SUPABASE_ANON_KEY;
const SECRET = () => process.env.AUTH_SECRET;

export const COOKIE = 'itin_user';
const MAX_AGE = 60 * 60 * 24 * 180;   // half a year; nobody wants to sign in every week

export const authConfigured = () => !!(URL_() && ANON() && SECRET());

export const normaliseEmail = (e) => String(e || '').trim().toLowerCase();

export const looksLikeEmail = (e) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normaliseEmail(e));

// Digits, plus an optional leading +. Deliberately loose: this is a field on a
// profile, not something anything depends on.
export const normalisePhone = (p) => {
  const t = String(p || '').trim().replace(/[\s()-]/g, '');
  if (!t) return '';
  return /^\+?\d{6,15}$/.test(t) ? t : null;
};

// --- the cookie -----------------------------------------------------------

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString();

const sign = (payload) =>
  crypto.createHmac('sha256', SECRET()).update(payload).digest('base64url');

export function makeToken(userId) {
  const body = b64(JSON.stringify({ u: userId, e: Date.now() + MAX_AGE * 1000 }));
  return body + '.' + sign(body);
}

// Returns the user id, or null. Never throws on malformed input — this runs on
// whatever the browser sends.
export function readToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  let expected;
  try { expected = sign(body); } catch (e) { return null; }
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  // Constant time, and length-checked first because timingSafeEqual throws on
  // a mismatch rather than returning false.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(unb64(body));
    if (!data.u || !data.e || Date.now() > data.e) return null;
    return data.u;
  } catch (e) {
    return null;
  }
}

export const cookieHeader = (token) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${MAX_AGE}`;

export const clearCookieHeader = () =>
  `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;

export function userFrom(req) {
  const raw = (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(COOKIE + '='));
  return raw ? readToken(decodeURIComponent(raw.slice(COOKIE.length + 1))) : null;
}

// --- the code ------------------------------------------------------------

async function authFetch(path, body) {
  const res = await fetch(URL_() + '/auth/v1/' + path, {
    method: 'POST',
    headers: { apikey: ANON(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }
  return { ok: res.ok, status: res.status, data, text };
}

export async function sendCode(email) {
  const r = await authFetch('otp', { email, create_user: true });
  if (r.ok) return { ok: true };
  // Supabase rate-limits email on the free tier, and that reads as a bug
  // unless it is said plainly.
  if (r.status === 429) {
    return { ok: false, error: 'Too many codes requested. Wait a minute and try again.' };
  }
  return { ok: false, error: (r.data && (r.data.msg || r.data.error_description)) || 'Could not send the code.' };
}

export async function checkCode(email, code) {
  const r = await authFetch('verify', { type: 'email', email, token: code });
  if (r.ok) return { ok: true };
  return { ok: false, error: 'That code is not right, or it has expired.' };
}
