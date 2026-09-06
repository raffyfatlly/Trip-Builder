// Agent messages, with the little structure they deserve.
//
// Everything was rendered as flat paragraphs, so a price, a hotel name and an
// aside all landed with exactly the same weight. That is not a formatting
// problem, it is a reading problem: the one number you wanted is buried in a
// wall of even grey.
//
// This is deliberately NOT a markdown renderer. It handles the five things
// that carry meaning in this conversation — emphasis, bulleted lists, numbered
// lists, prices, links — and passes everything else through as text.
//
// raffy, 2026-09-06: "Require bullet points, dashes, or numbered lists when
// presenting multiple items, strictly avoiding walls of raw text."
//
// Half of that is a prompt rule. The other half is here: the agent was already
// being told to use lists, and a numbered one came back as four naked
// paragraphs starting with digits, because only -/*/bullet was ever matched.
// Telling a model to format and then dropping the format on the floor is the
// worst of both. A general renderer would let the
// agent invent headings and tables and slowly turn the chat into a document,
// which is the same discipline the itinerary schema enforces everywhere else.

import { parse } from '../lib/richtext.js';

const PRICE = /((?:RM|USD?|S\$|A\$|€|£|¥|₫|IDR|SGD|THB|VND|PHP|MYR)\s?[\d][\d,.]*(?:\s?(?:k|m|million))?(?:\s?[-–]\s?[\d][\d,.]*)?|\b\d[\d,.]*\s?(?:VND|IDR|THB|PHP|MYR|SGD|USD)\b)/gi;

// Inline: **bold**, links, and prices. Order matters — links are pulled out
// first so a price inside a URL is not mangled.
function inline(text, keyBase) {
  const out = [];
  let i = 0;

  const push = (node) => out.push(node);
  const plain = (str, k) => {
    // Prices last, on whatever text is left.
    let last = 0;
    let m;
    PRICE.lastIndex = 0;
    while ((m = PRICE.exec(str))) {
      if (m.index > last) push(str.slice(last, m.index));
      push(<b className="cost" key={k + '-p' + m.index}>{m[0]}</b>);
      last = m.index + m[0].length;
    }
    if (last < str.length) push(str.slice(last));
  };

  const TOKEN = /\*\*(.+?)\*\*|(https?:\/\/[^\s<>"')]+)/g;
  let last = 0;
  let m;
  while ((m = TOKEN.exec(text))) {
    if (m.index > last) plain(text.slice(last, m.index), keyBase + '-' + i);
    if (m[1]) {
      push(<strong key={keyBase + '-b' + i}>{m[1]}</strong>);
    } else {
      const url = m[2];
      push(
        <a key={keyBase + '-a' + i} href={url} target="_blank" rel="noopener noreferrer">
          {url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 42)}
        </a>,
      );
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) plain(text.slice(last), keyBase + '-' + i);
  return out;
}


export default function Rich({ text }) {
  const blocks = parse(text);

  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'ul' || b.type === 'ol') {
          const items = b.items.map((it, j) => <li key={j}>{inline(it, i + '-' + j)}</li>);
          return b.type === 'ol' ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        return <p key={i}>{inline(b.text, String(i))}</p>;
      })}
      <style jsx>{`
        p{margin:0 0 8px}
        p:last-child{margin-bottom:0}
        ul,ol{margin:2px 0 8px;padding-left:17px;display:flex;flex-direction:column;gap:5px}
        ol{padding-left:20px}
        ul:last-child,ol:last-child{margin-bottom:0}
        li{line-height:1.5}
        li::marker{color:var(--ink-faint)}
        ol li::marker{font-variant-numeric:tabular-nums;font-weight:600}
      `}</style>
    </>
  );
}
