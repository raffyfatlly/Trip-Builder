// Proof that a share card's photo is one of ours.
//
// raffy, 2026-09-16: "why don't we also include the photo if lets say the app
// is already built. just use back the hero image."
//
// The hero is whatever find_photos found, and that is deliberately not a fixed
// set of hosts: Google Places for a restaurant, Wikimedia for a landmark, and
// for a hotel the best picture is almost always the one on the hotel's own
// site. So the card cannot be restricted to a list of domains without throwing
// away the photograph in the case that matters most.
//
// The card's photo arrives as a query parameter, though, and "fetch the URL in
// this parameter" is a server-side request forgery with a rendering engine
// attached — anyone could point it anywhere and use the deployment as a proxy.
//
// So the URL travels with a short signature only this deployment can produce.
// Any host is allowed; only our own pages can ask for one.
//
// Web Crypto rather than node:crypto because both ends need this: the page
// signs on the Node runtime and /api/og verifies on the edge one, and
// globalThis.crypto is the only implementation that exists in both.

const enc = new TextEncoder();

const b64url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const sha256 = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));

// The same choice lib/auth.js makes, and for the same reason: derived from the
// service account, so it is unguessable and survives a deploy. Its own
// namespace, so a share-card signature can never be replayed as a session
// cookie. The last fallback changes per deploy, which only means a card
// re-rendered from a stale crawler cache loses its photograph and falls back
// to the typographic card — not something anybody sees break.
let SECRET = null;
async function secret() {
  if (SECRET) return SECRET;
  if (process.env.AUTH_SECRET) {
    SECRET = 'og/' + process.env.AUTH_SECRET;
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    SECRET = b64url(await sha256('trip-builder/og/' + process.env.FIREBASE_SERVICE_ACCOUNT));
  } else {
    SECRET = 'trip-builder/og/' + (process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || 'local');
  }
  return SECRET;
}

let KEY = null;
async function key() {
  if (!KEY) {
    KEY = await crypto.subtle.importKey(
      'raw', enc.encode(await secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
  }
  return KEY;
}

/** A short tag for this exact URL. 132 bits, which is not worth attacking. */
export async function sign(url) {
  if (!url) return '';
  const mac = await crypto.subtle.sign('HMAC', await key(), enc.encode(String(url)));
  return b64url(new Uint8Array(mac)).slice(0, 22);
}

/** Compared without leaking where two tags start to differ. */
export async function signed(url, tag) {
  if (!url || !tag) return false;
  const want = await sign(url);
  if (want.length !== tag.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ tag.charCodeAt(i);
  return diff === 0;
}
