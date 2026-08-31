import { useState } from 'react';

// What the agent did, under what it said.
//
// raffy, 2026-08-31: "list the agents action like more transparent below it's
// chat reply".
//
// A turn that takes twenty seconds and returns three hotel prices reads as
// either magic or a stall. The four searches behind it cost nothing to show
// and turn both into "it went and looked" — and when it gets something wrong,
// the queries are the first place you'd want to look.
//
// Collapsed to one line by default: this is reassurance, not the content.

const ICONS = {
  search: <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3" />,
  check: <path d="M20 6 9 17l-5-5" />,
  pen: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
  star: <path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.2l5.9-.9z" />,
  build: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18" /></>,
  photo: <><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m5 17 4.5-4.5L19 19" /></>,
  dot: <circle cx="12" cy="12" r="3.2" />,
};

const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    {ICONS[name] || ICONS.dot}
  </svg>
);

export default function Actions({ actions }) {
  const [open, setOpen] = useState(false);
  if (!actions || !actions.length) return null;

  const searches = actions.filter((a) => a.icon === 'search').length;
  const summary = searches
    ? searches + (searches > 1 ? ' searches' : ' search')
      + (actions.length > searches ? ' and more' : '')
    : actions.length + (actions.length > 1 ? ' steps' : ' step');

  return (
    <div className={'acts' + (open ? ' open' : '')}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name={actions[0].icon} />
        <span>{summary}</span>
        <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {open && (
        <ul>
          {actions.map((a, i) => (
            <li key={i}>
              <Icon name={a.icon} />
              <span>
                {a.text}
                {a.detail && <i>{a.detail}</i>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <style jsx>{`
        .acts{margin:7px 0 0}
        button{
          display:inline-flex;align-items:center;gap:6px;border:0;background:none;
          padding:3px 0;font-family:inherit;font-size:11.5px;font-weight:600;
          color:var(--ink-faint);cursor:pointer;
        }
        button:hover{color:var(--ink-soft)}
        button :global(svg){width:12px;height:12px;flex:none}
        .chev{transition:transform 200ms var(--e)}
        .acts.open .chev{transform:rotate(180deg)}

        ul{
          margin:6px 0 0;padding:0 0 0 2px;list-style:none;
          display:flex;flex-direction:column;gap:6px;
          animation:rise 200ms var(--e) both;
        }
        li{display:flex;gap:7px;align-items:flex-start;font-size:11.5px;line-height:1.4}
        li :global(svg){width:12px;height:12px;flex:none;margin-top:2px;color:var(--ink-faint)}
        li span{display:flex;flex-direction:column;gap:1px;min-width:0;color:var(--ink-soft)}
        li i{font-style:normal;color:var(--ink-faint);overflow-wrap:anywhere}
        @keyframes rise{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
      `}</style>
    </div>
  );
}
