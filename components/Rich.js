// Agent messages, with the little structure they deserve.
//
// Everything was rendered as flat paragraphs, so a price, a hotel name and an
// aside all landed with exactly the same weight. That is not a formatting
// problem, it is a reading problem: the one number you wanted is buried in a
// wall of even grey.
//
// This is deliberately NOT a markdown renderer. It handles the four things
// that carry meaning in this conversation — emphasis, lists, prices, links —
// and passes everything else through as text. A general renderer would let the
// agent invent headings and tables and slowly turn the chat into a document,
// which is the same discipline the itinerary schema enforces everywhere else.

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
  const lines = String(text || '').split('\n');
  const blocks = [];
  let list = null;

  const flush = () => {
    if (list && list.length) blocks.push({ type: 'ul', items: list });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    if (bullet) {
      list = list || [];
      list.push(bullet[1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push({ type: 'p', text: line });
  }
  flush();

  return (
    <>
      {blocks.map((b, i) => (
        b.type === 'ul' ? (
          <ul key={i}>
            {b.items.map((it, j) => <li key={j}>{inline(it, i + '-' + j)}</li>)}
          </ul>
        ) : (
          <p key={i}>{inline(b.text, String(i))}</p>
        )
      ))}
      <style jsx>{`
        p{margin:0 0 8px}
        p:last-child{margin-bottom:0}
        ul{margin:2px 0 8px;padding-left:17px;display:flex;flex-direction:column;gap:5px}
        ul:last-child{margin-bottom:0}
        li{line-height:1.5}
        li::marker{color:var(--ink-faint)}
      `}</style>
    </>
  );
}
