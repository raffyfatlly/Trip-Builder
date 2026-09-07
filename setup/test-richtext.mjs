// What a chat message is made of.
//
// raffy, 2026-09-07, with a screenshot of his Kuching chat: "improve how the
// chat display links and any other info, not long strain of text in paragraph.
// make it look beautiful."
//
// The screenshot showed the agent's perfectly ordinary markdown link rendered
// as `[Sheraton Kuching on Marriott.com](marriott.com/en-us/hotels/kchsi-sh` —
// brackets and all, URL broken across lines mid-word. The tokenizer matched
// **bold** and BARE urls, and `[label](url)` matched neither, so the label fell
// through as text while the URL inside the parens linkified on its own.
//
// It lived in a component where nothing could test it. It lives in lib now.
import assert from 'node:assert';
import { parse, tokens, linkLabel } from '../lib/richtext.js';

let n = 0;
const t = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };
const kinds = (s) => tokens(s).map((x) => x.t).join(' ');
const link = (s) => tokens(s).find((x) => x.t === 'link');

console.log('\nThe bug in the screenshot');
{
  const src = 'Best bet: [Sheraton Kuching on Marriott.com](https://marriott.com/en-us/hotels/kchsi-sheraton-k) today.';
  t('a markdown link is one link, not brackets plus a url', () => {
    assert.equal(kinds(src), 'text link text');
  });
  t('and it reads as its label, not its address', () => {
    assert.equal(link(src).v, 'Sheraton Kuching on Marriott.com');
    assert.equal(link(src).href, 'https://marriott.com/en-us/hotels/kchsi-sheraton-k');
  });
  t('no bracket survives into the text', () => {
    const text = tokens(src).filter((x) => x.t === 'text').map((x) => x.v).join('');
    assert.ok(!/[[\]()]/.test(text), text);
  });
}

console.log('\nA bare url says where it goes, not how to get there');
{
  // The old renderer printed 42 characters of path, which is what wrapped
  // across two lines and made the paragraph look broken.
  t('a long url shows its host', () => {
    assert.equal(link('see https://search.hotellook.com/?destination=Kuching&adults=2 ok').v,
      'search.hotellook.com');
  });
  t('www is dropped', () => {
    assert.equal(link('https://www.booking.com/searchresults.html?ss=X').v, 'booking.com');
  });
  t('a label always wins over the host', () => {
    assert.equal(linkLabel('https://www.booking.com/x', 'Book it'), 'Book it');
    assert.equal(linkLabel('https://www.booking.com/x', '   '), 'booking.com');
  });
  t('a trailing bracket or quote is not part of the url', () => {
    assert.equal(link('(see https://example.com/a)').href, 'https://example.com/a');
  });
}

console.log('\nEmphasis, and what must stay literal');
{
  t('**bold** and *italic* are different things', () => {
    assert.equal(kinds('**a** and *b*'), 'bold text em');
  });
  t('bold is matched before italic, so ** is never eaten one star at a time', () => {
    assert.deepEqual(tokens('**RM210**'), [{ t: 'bold', v: 'RM210' }]);
  });
  t('arithmetic and stray asterisks stay literal', () => {
    assert.equal(kinds('2 * 3 * 4'), 'text');
    assert.equal(kinds('a*b*c'), 'text');
  });
  t("the agent's own \"What I *can* do\" no longer shows its asterisks", () => {
    assert.equal(tokens('What I *can* do:').find((x) => x.t === 'em').v, 'can');
  });
}

console.log('\nPrices still stand out, and never inside a link');
{
  t('a price is picked out of ordinary text', () => {
    assert.equal(tokens('it is RM319 total').find((x) => x.t === 'price').v, 'RM319');
  });
  t('a url containing digits is not chopped up as a price', () => {
    assert.equal(kinds('https://example.com/a/12345'), 'link');
  });
}

console.log('\nBlocks');
{
  t('a dash list and a numbered list are both lists', () => {
    assert.equal(parse('- a\n- b')[0].type, 'ul');
    assert.equal(parse('1. a\n2. b')[0].type, 'ol');
  });
  t('a year or a price cannot start a list', () => {
    assert.equal(parse('2026 was the year')[0].type, 'p');
  });
  t('changing marker starts a second list', () => {
    assert.deepEqual(parse('- a\n1. b').map((b) => b.type), ['ul', 'ol']);
  });
}

console.log('\n' + n + ' passed');
