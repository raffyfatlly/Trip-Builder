// The build has to keep going when nobody is looking.
//
// raffy, 2026-09-09: "still nothing. nothing trigger."
//
// /api/advance ends with `if (state && state.building) chain(...)` — one more
// invocation of itself, so a build carries on after the response is sent. It
// had never fired: advanceState returned { ok, steps } and nothing else, so
// `state.building` was always undefined and chain() was unreachable code from
// the day it was written. A build therefore only advanced when the browser
// fired a timer, and mobile Chrome throttles a backgrounded tab to almost
// nothing — three advances in twenty-five minutes on his production log, where
// an open page should produce six hundred.
//
//   node setup/test-chain.mjs
import fs from 'fs';

let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

console.log('');

// The contract is between two files, so it is checked across both.
const api = fs.readFileSync('pages/api/advance.js', 'utf8');
const lib = fs.readFileSync('lib/managedAgents.js', 'utf8');

const gate = /if \(state && state\.(\w+)\) chain\(/.exec(api);
ok('the endpoint still chains on a field of the returned state', !!gate, gate && gate[1]);

if (gate) {
  const field = gate[1];
  // Every return from advanceState has to carry it, or the chain silently dies
  // again — which is exactly how this went unnoticed for days.
  const body = lib.slice(lib.indexOf('export async function advanceState'));
  const end = body.indexOf('\n}\n');
  const returns = (body.slice(0, end).match(/return \{[^}]*\}/g) || []);
  ok('advanceState has returns to check', returns.length > 0, returns.length + ' returns');
  const missing = returns.filter((r) => !new RegExp('\\b' + field + '\\b').test(r));
  ok('and every one of them reports ' + field, missing.length === 0,
     missing.join(' | ').slice(0, 160));
}

// The early exit matters most, and it is the one the first run of this test
// caught: a session with no build returns before any of the work, and that
// return must say "not building" on purpose rather than by omission.
{
  const body = lib.slice(lib.indexOf('export async function advanceState'));
  const early = /if \(!latest\) return \{[^}]*\}/.exec(body.slice(0, body.indexOf('\n}\n')));
  ok('the no-build exit says so too', !!early && /building: false/.test(early[0]),
     early ? early[0] : 'no early return found');
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
