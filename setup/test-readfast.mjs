// The page must render even when the agent is stuck.
//
// raffy, 2026-09-01: "still blank for italy." The first fix (timeouts on every
// fetch) was necessary and not sufficient — nothing was hanging. /api/state
// itself advanced the build BEFORE and AFTER pumping the chat, so one poll
// could make two model calls plus their tool work and blow past Vercel's
// 300-second ceiling. The conversation was intact; the endpoint that reads it
// was busy doing the agent's work.
//
// Reading and advancing are separate endpoints now. This checks the read one
// stays a read.
//
//   node setup/test-readfast.mjs

import fs from 'fs';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ok    ' : '  FAIL  ') + n + (x ? '   ' + x : '')); if (!c) fail++; };

const ma = fs.readFileSync('lib/managedAgents.js', 'utf8');
const getState = ma.slice(ma.indexOf('export async function getState'));

// The read path must not call anything that spends money or writes.
for (const forbidden of ['advanceBuild', 'pumpChat', 'pumpBuilder', 'sendUserMessage', 'createSession', 'startBuild']) {
  ok('getState never calls ' + forbidden, !getState.includes(forbidden + '('));
}
ok('getState reads the build instead', getState.includes('look(') || ma.includes('peekBuild'));

const look = ma.slice(ma.indexOf('async function look('), ma.indexOf('export async function advanceState'));
ok('and look() only peeks', !look.includes('advanceBuild(') && !look.includes('pumpBuilder('));

// The advancing path is where the work belongs.
const adv = ma.slice(ma.indexOf('export async function advanceState'), ma.indexOf('export async function getState'));
ok('advanceState pumps the chat', adv.includes('pumpChat('));
ok('advanceState takes one build step', adv.includes('advanceBuild(') && adv.includes('pumpBuilder('));

// Endpoint budgets: the reader must be capped well under Vercel's ceiling.
const state = fs.readFileSync('pages/api/state.js', 'utf8');
const m = state.match(/maxDuration:\s*(\d+)/);
ok('/api/state declares a maxDuration', !!m, m && m[1]);
ok('and it is well under the 300s ceiling', !!m && Number(m[1]) <= 60, m && m[1] + 's');

const advance = fs.readFileSync('pages/api/advance.js', 'utf8');
ok('/api/advance exists and calls advanceState', advance.includes('advanceState('));

// The browser has to actually drive both.
const idx = fs.readFileSync('pages/index.js', 'utf8');
ok('the browser polls /api/state', idx.includes("'/api/state?session='"));
ok('and separately drives /api/advance', idx.includes("'/api/advance?session='"));
ok('with only one advance in flight at a time', idx.includes('inFlight'));
ok('and a timeout on the render poll', idx.includes('POLL_TIMEOUT_MS'));

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
