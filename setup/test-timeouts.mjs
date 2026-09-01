// Nothing waits forever.
//
// raffy, 2026-09-01, on the Italy trip: "ai is lodding too long, after refresh
// the italy page all gone."
//
// /api/state answers the agent's pending tool calls inline, so one slow host —
// a hotel website that accepts the connection and never replies — held the
// request open until Vercel killed it at 300s. Four of those are in the
// production logs. The tool result was never written back, so the next poll
// hung the same way, and a refresh could not get past it.
//
//   node setup/test-timeouts.mjs

import http from 'http';
import { fetchWith, deadline, Timeout } from '../lib/net.js';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

// A server that accepts the connection and then says nothing at all — exactly
// the failure mode that took the page down.
const black = http.createServer(() => { /* never responds */ });
await new Promise((r) => black.listen(0, '127.0.0.1', r));
const hole = 'http://127.0.0.1:' + black.address().port + '/';

const t0 = Date.now();
let caught = null;
try { await fetchWith(hole, 400); } catch (e) { caught = e; }
const took = Date.now() - t0;

ok('a server that never replies throws instead of hanging', !!caught);
ok('and it is recognisably a timeout', caught instanceof Timeout && caught.timeout === true,
   caught && caught.name);
ok('within the time it was given', took < 2500, took + 'ms');
ok('the message says what timed out', !!caught && caught.message.includes('127.0.0.1'));

// A working server still works.
const good = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
await new Promise((r) => good.listen(0, '127.0.0.1', r));
const okUrl = 'http://127.0.0.1:' + good.address().port + '/';
const r = await fetchWith(okUrl, 3000);
ok('a fast server is unaffected', (await r.json()).ok === true);

// The shared budget: several slow calls cannot outlast the whole allowance.
const b = deadline(300);
ok('a fresh budget has time left', b.left() > 0 && !b.spent());
ok('a slice never exceeds what is left', b.slice(99999) <= 300);
await new Promise((r2) => setTimeout(r2, 340));
ok('and it expires', b.spent() && b.left() === 0);
ok('an expired budget still returns a usable slice', b.slice(5000) === 1);

// The real thing: every server-side fetch goes through it.
import fs from 'fs';
const files = ['lib/photos.js', 'lib/orBuilder.js', 'lib/managedAgents.js', 'lib/db.js',
               'lib/firestore.js', 'pages/api/photo.js', 'pages/api/upload.js'];
const bare = files.filter((f) => /[^h]\bawait fetch\(/.test(fs.readFileSync(f, 'utf8')));
ok('no unbounded fetch is left on the server', bare.length === 0, bare.join(', '));

black.close(); good.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
