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

import { parse, tokens } from '../lib/richtext.js';

// A link is a CHIP, not underlined text in the middle of a sentence.
//
// raffy, 2026-09-07, with a screenshot: "improve how the chat display links and
// any other info, not long strain of text in paragraph. make it look
// beautiful." In that screenshot a hotel URL had been linkified in place and
// wrapped across two lines mid-word, so the paragraph was cut in half by a
// grey ladder of address. Two problems in one: it read as damage, and it gave
// no clue what it would open.
//
// A chip fixes both. It cannot break across lines, it names its destination
// rather than reciting a path, and it is a tap target rather than a word that
// happens to be underlined. The little arrow says it leaves the app.
//
// A `tel:` chip is the same idea one step further: on the phone this app is
// actually used on, tapping it opens the dialler with the number in it. It gets
// a handset rather than the leaving-the-app arrow, and no target="_blank" — a
// new tab that immediately hands off to the dialler and then sits there empty
// is the kind of small mess nobody reports and everybody notices.
function Chip({ href, children }) {
  const call = /^tel:/i.test(String(href || ''));
  return (
    <a className={'chip' + (call ? ' call' : '')} href={href}
      {...(call ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
      {children}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {call
          ? <path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 5 5.1 1.5 1.5 0 0 1 6.5 3.5z" />
          : <path d="M7 17 17 7M9 7h8v8" />}
      </svg>
    </a>
  );
}

function inline(text, keyBase) {
  return tokens(text).map((t, i) => {
    const k = keyBase + '-' + i;
    if (t.t === 'link') return <Chip key={k} href={t.href}>{t.v}</Chip>;
    if (t.t === 'bold') return <strong key={k}>{t.v}</strong>;
    if (t.t === 'em') return <em key={k}>{t.v}</em>;
    if (t.t === 'price') return <b className="cost" key={k}>{t.v}</b>;
    return t.v;
  });
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

        /* :global — Chip is its own component, and a styled-jsx block only
           scopes JSX written in the same one. Without this the rules are
           silently dead, which has caught me three times in this codebase. */
        :global(.chip){
          display:inline-flex;align-items:center;gap:4px;
          /* Never split across lines. The whole point. */
          white-space:nowrap;max-width:100%;
          vertical-align:baseline;margin:0 1px;
          padding:2px 8px 2px 9px;border-radius:8px;
          background:var(--sage);color:var(--deep);
          font-size:.92em;font-weight:650;line-height:1.5;
          text-decoration:none;
          transition:background 140ms ease;
        }
        /* A long label truncates rather than forcing the chip off the edge. */
        :global(.chip){overflow:hidden;text-overflow:ellipsis}
        :global(.chip:hover),:global(.chip:active){background:#D7E2D2}
        :global(.chip) svg{
          width:11px;height:11px;flex:none;opacity:.55;margin-top:-1px;
        }
        /* On the traveller's own dark bubble the sage chip would vanish. */
        :global(.msg.user) :global(.chip){
          background:rgba(255,255,255,.16);color:#EAF2EC;
        }
        :global(.msg.user) :global(.chip:hover){background:rgba(255,255,255,.26)}
      `}</style>
    </>
  );
}
