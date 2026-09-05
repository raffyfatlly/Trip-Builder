// Runtime settings, without a dashboard.
//
// raffy, 2026-09-02: "don't ask me to put in env. for now just put it where it
// works."
//
// One Firestore document, read at runtime, cached for five minutes. The
// environment wins wherever it is set, so a deliberate deployment variable is
// never overridden by something written here.
//
// This started life inside lib/prices.js, which owned it because it was the
// first thing that needed a token. It is now also how the builder is switched
// between providers without a deploy, so it lives on its own.

let CONFIG = null;
let CONFIG_AT = 0;
const TTL = 300000;

export async function loadConfig() {
  if (CONFIG && Date.now() - CONFIG_AT < TTL) return CONFIG;
  try {
    const { readConfig, firestoreConfigured } = await import('./firestore.js');
    CONFIG = firestoreConfigured() ? await readConfig() : {};
  } catch (err) {
    // No store, or it is down. Everything that reads a setting falls back to
    // its own default; nothing here is load-bearing enough to fail a request.
    CONFIG = CONFIG || {};
  }
  CONFIG_AT = Date.now();
  return CONFIG;
}

/** The last loaded snapshot. Empty until something has awaited loadConfig(). */
export const snapshot = () => CONFIG || {};

/** Environment first, then the stored config, then the given default. */
export const setting = (envName, key, fallback = '') =>
  process.env[envName] || snapshot()[key] || fallback;

export const _reset = () => { CONFIG = null; CONFIG_AT = 0; };
