// A request that spends nothing must not touch the database.
//
// raffy's production log, 2026-09-06: "journal: timed out after 15000ms" on
// nearly every line — /api/me, /api/state, /api/advance, /api/photo, /api/bake.
//
// The cause was not size and not the function freezing (both guessed wrong
// first). settle() ran on EVERY request, and settle reads the whole journal and
// writes it back before it can discover there is nothing to charge. The chat
// polls every 2.5 seconds, so each open tab was two Firestore round trips a
// second for nothing, queued per session, stacking until they blew the timeout.

import assert from 'node:assert';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

// Count what reaches Firestore. Everything below goes through fetch.
let reads = 0, writes = 0;
const real = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('firestore.googleapis.com')) {
    if ((opts.method || 'GET') === 'GET') reads++; else writes++;
    return { ok: true, status: 404, headers: new Headers(), text: async () => '' };
  }
  if (u.startsWith('https://oauth2.googleapis.com')) {
    return { ok: true, headers: new Headers(), json: async () => ({ access_token: 't', expires_in: 3600 }) };
  }
  return real(url, opts);
};

import crypto from 'crypto';
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'p', client_email: 'a@b.c', private_key: privateKey,
});
process.env.JOURNAL_LOCAL = '1';        // deployed(), so the journal is live

const { billed } = await import('../lib/billed.js');
const { addMetered } = await import('../lib/journal.js');

const res = () => {
  const r = { statusCode: 0, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
};
const req = (q) => ({ method: 'GET', query: q, headers: {}, cookies: {} });

// The journal ignores anything that is not a plausible session id, so a short
// stub would make every assertion below pass without proving anything. It did,
// on the first run of this file.
const { } = {};

console.log('\nA poll that spends nothing');

{
  reads = 0; writes = 0;
  // A handler that does no billable work at all — which is what /api/state is
  // on the vast majority of its polls.
  const h = billed(async (rq, rs) => rs.status(200).json({ ok: true }));
  await h(req({ session: 'sesn_01AAAAAAAAAAAAAAAAAAAAAA' }), res());
  await new Promise((r) => setTimeout(r, 120));
  t('touches the database not at all', () => {
    assert.equal(reads + writes, 0, reads + ' reads, ' + writes + ' writes');
  });
}

{
  reads = 0; writes = 0;
  const h = billed(async (rq, rs) => rs.status(200).json({ ok: true }));
  // Ten polls, which is twenty-five seconds of one open tab.
  for (let i = 0; i < 10; i++) await h(req({ session: 'sesn_01BBBBBBBBBBBBBBBBBBBBBB' }), res());
  await new Promise((r) => setTimeout(r, 200));
  t('and ten of them are still nothing', () => {
    assert.equal(reads + writes, 0, reads + ' reads, ' + writes + ' writes');
  });
}

console.log('\nA request that does spend');

{
  reads = 0; writes = 0;
  // addMetered is what the meter calls; going through it directly proves the
  // write path still works rather than that it has been switched off.
  const w = addMetered('sesn_01CCCCCCCCCCCCCCCCCCCCCC', { chat: { calls: 1, usd: 0.5 } }, 'raffy@example.com');
  assert.ok(w, 'metering real spend must return a write');
  await w;
  t('is written down', () => {
    assert.ok(reads + writes > 0, 'expected the journal to be touched');
  });
}

console.log('\n' + n + ' passed\n');
