// How an agent message breaks into paragraphs and lists.
//
// Plain JS with no JSX, so it can be imported by a test as well as by the
// component that draws it. The drawing lives in components/Rich.js; the
// decisions about what IS a list live here.
//
// raffy, 2026-09-06: "Require bullet points, dashes, or numbered lists when
// presenting multiple items, strictly avoiding walls of raw text."
//
// Half of that rule is in the prompt. This is the other half: the agent was
// already told to use lists, and a numbered one came back as four naked
// paragraphs starting with digits, because only -/*/bullet was ever matched.
// Telling a model to format and then dropping the format on the floor is the
// worst of both.

export function parse(text) {
  const lines = String(text || '').split('\n');
  const blocks = [];
  let list = null;
  let listType = null;

  const flush = () => {
    if (list && list.length) blocks.push({ type: listType, items: list });
    list = null;
    listType = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    // "1." and "1)" both, because models write both. A bare year or a price
    // cannot start a list item: the digits must be followed by . or ) and a
    // space, which "2026 was the year" and "RM1,200 a night" never are.
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    const numbered = !bullet && line.match(/^\s*\d{1,2}[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const want = bullet ? 'ul' : 'ol';
      // A list that changes marker mid-way is two lists.
      if (listType && listType !== want) flush();
      list = list || [];
      listType = want;
      list.push((bullet || numbered)[1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push({ type: 'p', text: line });
  }
  flush();
  return blocks;
}

// What a line is made of: text, emphasis, links, prices.
//
// This lived inside components/Rich.js, where nothing could test it — and it
// had a hole worth the move. raffy, 2026-09-07, with a screenshot of his
// Kuching chat: the agent wrote a perfectly ordinary markdown link and the page
// showed
//
//     [Sheraton Kuching on Marriott.com](marriott.com/en-us/hotels/kchsi-sh
//     eraton-k) for whatever it shows today.
//
// — brackets and all, the URL broken across two lines mid-word. The tokenizer
// matched `**bold**` and BARE http links, and `[label](url)` matched neither:
// the bracketed label fell through as text and the URL inside the parens got
// linkified on its own. The agent was formatting correctly the whole time.
//
// Two things fix how it reads, and both are here rather than in the styling:
// the label is used when there is one, and a bare URL is shown as its HOST
// rather than 42 characters of path. A link should say where it goes, not
// recite its address.

const PRICE = /((?:RM|USD?|S\$|A\$|€|£|¥|₫|IDR|SGD|THB|VND|PHP|MYR)\s?[\d][\d,.]*(?:\s?(?:k|m|million))?(?:\s?[-–]\s?[\d][\d,.]*)?|\b\d[\d,.]*\s?(?:VND|IDR|THB|PHP|MYR|SGD|USD)\b)/gi;

// Order matters. The markdown form has to be tried BEFORE the bare URL, or the
// bare-URL branch eats the inside of the parens and leaves the brackets behind
// — which is exactly the bug above.
const TOKEN = new RegExp([
  /\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]+)\)/.source,   // [label](url)
  /\*\*([^*\n]+?)\*\*/.source,                            // **bold**
  /(https?:\/\/[^\s<>"')]+)/.source,                      // a bare url
  // *italic*, after bold so ** never gets eaten one asterisk at a time. The
  // guards matter: no space just inside the marks, so "2 * 3 * 4" and a
  // footnote asterisk stay literal, and the agent's own "What I *can* do"
  // stops showing its asterisks — which it was.
  /(?<![*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/.source,
].join('|'), 'g');

/** How a link should read: its label, or failing that its host. */
export function linkLabel(url, label) {
  const clean = String(label || '').trim();
  if (clean) return clean;
  try {
    const u = new URL(url);
    // The host is what tells someone where they are going. A path adds length
    // and almost never adds meaning.
    return u.hostname.replace(/^www\./, '');
  } catch (e) {
    return String(url).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 40);
  }
}

/** Split one line into renderable pieces. Pure — components/Rich.js draws them. */
export function tokens(text) {
  const out = [];
  const src = String(text || '');

  // Prices, on whatever is not a link or bold.
  const plain = (str) => {
    let last = 0;
    let m;
    PRICE.lastIndex = 0;
    while ((m = PRICE.exec(str))) {
      if (m.index > last) out.push({ t: 'text', v: str.slice(last, m.index) });
      out.push({ t: 'price', v: m[0] });
      last = m.index + m[0].length;
    }
    if (last < str.length) out.push({ t: 'text', v: str.slice(last) });
  };

  let last = 0;
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    if (m.index > last) plain(src.slice(last, m.index));
    if (m[2]) out.push({ t: 'link', href: m[2], v: linkLabel(m[2], m[1]) });
    else if (m[3]) out.push({ t: 'bold', v: m[3] });
    else if (m[4]) out.push({ t: 'link', href: m[4], v: linkLabel(m[4]) });
    else out.push({ t: 'em', v: m[5] });
    last = m.index + m[0].length;
  }
  if (last < src.length) plain(src.slice(last));
  return out;
}
