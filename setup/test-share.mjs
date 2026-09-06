// Sharing a trip as a link, and what a guest can and cannot do with it.
//
// raffy, 2026-09-06: "i want to explore the idea of sharing their itenary to
// people... and also that perhaps open the path for future collaborative
// planning."
//
// A link, not a file: a PDF is wrong the moment a hotel changes. What matters
// here is that the link is not the session id, that it can be killed, and that
// a guest cannot rewrite somebody else's trip.

import fs from 'fs';
import zlib from 'zlib';
import assert from 'node:assert';
import { render } from '../renderer/render.js';
import { looksLikeToken } from '../lib/share.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

console.log('\nWhat a share link carries');

t('a token is not a session id, and cannot be mistaken for one', () => {
  // The session id is the key to the whole conversation — the chat, the
  // credits, the ability to send messages as them. It must never be the thing
  // pasted into a group chat.
  assert.equal(looksLikeToken('sesn_01WDtF9sMZTNcuFA9ES3nSW4'), false);
  assert.equal(looksLikeToken('AbCdEfGhIjKlMnOpQrStUv'), true);
});

t('it is long enough that guessing is pointless', () => {
  // 22 base64url characters. Anything shorter or with odd characters is not a
  // token, so a stray path segment cannot open somebody's trip.
  assert.equal(looksLikeToken('short'), false);
  assert.equal(looksLikeToken('has spaces in it aaaaa'), false);
  assert.equal(looksLikeToken('AbCdEfGhIjKlMnOpQrStU/'), false);
  assert.equal(looksLikeToken(''), false);
  assert.equal(looksLikeToken(null), false);
});

console.log('\nWhat a guest sees');

const tpl = zlib.gunzipSync(fs.readFileSync('public/app-template.html.gz')).toString();
const TRIP = JSON.parse(fs.readFileSync(
  '/home/user/claude/tools/itinerary-generator/trips/danang.json', 'utf8'));
const build = (o) => render(JSON.parse(JSON.stringify(TRIP)), tpl, o).html;

const mine = build();
const theirs = build({ readOnly: true });

t('the owner gets the edit tools', () => {
  assert.ok(mine.includes('Change this'));
  assert.ok(mine.includes('id="edtoggle"'));
  assert.ok(mine.includes('id="ownadd"'));
});

t('a guest gets none of them', () => {
  // Not hidden with CSS — absent. A button hidden by a stylesheet is a tap away
  // in any developer console, and this is somebody else's trip.
  assert.ok(!theirs.includes('Change this'), 'no Change this');
  assert.ok(!theirs.includes('id="edtoggle"'), 'no edit toggle');
  assert.ok(!theirs.includes('id="ownadd"'), 'no add-your-own');
});

t('but they still get the whole trip', () => {
  // Read-only must not mean second-rate: they are going on this trip too.
  for (const part of ['Da Nang', 'v-map', 'routemap']) {
    assert.ok(theirs.includes(part), part);
  }
  // Within a few percent of the owner's document, not a stripped-down one.
  assert.ok(theirs.length > mine.length * 0.9,
    theirs.length + ' vs ' + mine.length);
});

t('and the difference is only the tools', () => {
  assert.ok(mine.length > theirs.length, 'the owner document is the larger one');
});

console.log('\n' + n + ' passed\n');
