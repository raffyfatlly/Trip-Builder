// A session has to survive a deploy.
//
// The signing key used to fall back to VERCEL_DEPLOYMENT_ID, which changes on
// every deploy — so every cookie stopped verifying and everyone was silently
// signed out. Six deploys in an afternoon meant signing in six times.
// (raffy, 2026-09-01: "it keep asking me to save the profile. need to put
// email many times. confusing feeling.")
//
//   node setup/test-authsecret.mjs

process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"trip-builder-d4ae6","private_key":"xyz"}';
process.env.VERCEL_DEPLOYMENT_ID = 'dpl_AAA';
delete process.env.AUTH_SECRET;
const { makeToken, readToken } = await import('../lib/auth.js');
const t = makeToken('raffy@example.com');
let fail = 0;
const ok = (n, c) => { console.log((c ? '  ok    ' : '  FAIL  ') + n); if (!c) fail++; };
ok('a fresh token reads back', readToken(t) === 'raffy@example.com');
process.env.VERCEL_DEPLOYMENT_ID = 'dpl_BBB';   // a deploy happened
ok('and still reads back after a deploy', readToken(t) === 'raffy@example.com');
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"someone-else"}';
ok('but not with a different service account', readToken(t) === null);
ok('a forged token is refused', readToken('eyJ1IjoieCJ9.deadbeef') === null);
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
