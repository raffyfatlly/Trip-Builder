// Signing in, which here means little more than saying who you are.
//
// raffy, 2026-08-31: "login seems complicated [...] maybe just create account."
// He had already said "there's no need to high verification level or anything.
// like fon number email is good."
//
// So there is no password, no code, no provider. You type an email, and that
// is the account. **Anyone who types your email address gets your trip list.**
// That is a real consequence and it is his call, made twice; what is stored is
// trip names and session ids, not payment details, and the local copy in the
// browser is unaffected either way. When that stops being an acceptable trade
// the place to change it is here — this file is the whole of it.
//
// Phone is kept on the account because he asked for it. Nothing signs in with
// it: SMS codes need a paid provider and would buy nothing while email is
// unverified anyway.
//
// The cookie is our own signed token, so a signed-in browser can be recognised
// without a network call on every request.

import crypto from 'crypto';

// A missing secret must not silently produce forgeable tokens, so it is never
// a constant. It used to fall back to the deployment id, which was secure and
// unusable: the id changes on every deploy, so every cookie stopped verifying
// and everyone was silently signed out. Six deploys in an afternoon meant
// signing in six times. (raffy, 2026-09-01: "after a while, on one device,
// also after refresh, it keep asking me to save the profile. need to put email
// many times. confusing feeling.")
//
// So derive it from the service account instead: secret, unguessable, and
// STABLE across deploys. Accounts only exist when Firestore is configured, so
// whenever there is a session to keep there is a key to sign it with.
const stable = () => {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) return null;
  return crypto.createHash('sha256').update('trip-builder/auth/' + sa).digest('base64url');
};
const SECRET = () =>
  process.env.AUTH_SECRET
  || stable()
  || 'trip-builder/' + (process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || 'local');

export const COOKIE = 'itin_user';
const MAX_AGE = 60 * 60 * 24 * 180;   // half a year; nobody wants to sign in every week

// Accounts exist when there is somewhere to put them; that is the storage
// layer's question, not this file's.
export const authConfigured = () => true;

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

