// Rendering for the agent's structured content: options to pick between, and
// researched numbers. Tapping an option sends it back as a message, so the
// conversation carries on normally and typing is always still available.

export default function Block({ block, onChoose, disabled }) {
  const { kind, title, intro, items, facts, choose } = block;

  return (
    <div className="block">
      <div className="bhead">
        <h4>{title}</h4>
        {intro && <p>{intro}</p>}
      </div>

      {kind === 'facts' && (
        <div className="facts">
          {(facts || []).map((f, i) => (
            <div key={i} className="fact">
              <div className="l">{f.label}</div>
              <div className="v">{f.value}</div>
              {f.note && <div className="n">{f.note}</div>}
            </div>
          ))}
        </div>
      )}

      {kind === 'options' && (items || []).map((o, i) => (
        <div key={i} className="opt">
          <div className="top">
            <div className="name">{o.name}</div>
            {o.price && <div className="price">{o.price}</div>}
          </div>
          {o.meta && <div className="meta">{o.meta}</div>}
          <div className="why">{o.why}</div>
          {o.watch && (
            <div className="watch">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
              <span>{o.watch}</span>
            </div>
          )}
          {(o.tags || []).length > 0 && (
            <div className="tags">{o.tags.map((t) => <span key={t}>{t}</span>)}</div>
          )}
          <div className="acts">
            {choose && (
              <button className="pick" disabled={disabled}
                onClick={() => onChoose(`Let's go with ${o.name}.`)}>
                Choose this
              </button>
            )}
            <button className="more" disabled={disabled}
              onClick={() => onChoose(`Tell me more about ${o.name}.`)}>
              Tell me more
            </button>
            {o.link && (
              <a className="link" href={o.link} target="_blank" rel="noopener noreferrer">Open</a>
            )}
          </div>
        </div>
      ))}

      <style jsx>{`
        .block{
          margin:10px 0;animation:rise 260ms cubic-bezier(.23,1,.32,1) both;
          max-width:min(92%,56ch);
        }
        .bhead{padding:2px 4px 9px}
        .bhead h4{
          margin:0;font-family:'Outfit',sans-serif;font-size:17px;font-weight:700;
          line-height:1.25;
        }
        .bhead p{margin:4px 0 0;font-size:13px;color:var(--ink-faint);line-height:1.45}

        .facts{
          background:var(--surface);border-radius:20px;padding:6px 16px;
          box-shadow:var(--sh-s);
        }
        .fact{padding:11px 0;border-bottom:1px solid var(--line)}
        .fact:last-child{border-bottom:0}
        .fact .l{font-size:12.5px;color:var(--ink-faint);font-weight:600}
        .fact .v{font-size:16px;font-weight:700;margin-top:2px;font-family:'Outfit',sans-serif}
        .fact .n{font-size:12.5px;color:var(--ink-soft);margin-top:3px;line-height:1.4}

        .opt{
          background:var(--surface);border-radius:20px;padding:15px 16px;
          box-shadow:var(--sh-s);margin-bottom:9px;
        }
        /* Price sits on its own line rather than beside the name. A real
           researched price is often a range with a qualifier ("typically
           $76-117/night, deals from ~$64"), which on one row overflowed the
           card and squeezed the name to one word per line. */
        .top{display:block}
        .name{font-size:15.5px;font-weight:700;line-height:1.3}
        .price{
          font-family:'Outfit',sans-serif;font-size:14px;font-weight:700;
          color:var(--coral-text,#AE4715);line-height:1.35;margin-top:4px;
        }
        .meta{font-size:12.5px;color:var(--ink-faint);margin-top:4px}
        .why{font-size:13.5px;line-height:1.5;color:var(--ink-soft);margin-top:9px}
        .watch{
          display:flex;gap:7px;align-items:flex-start;margin-top:9px;
          background:#FBE6DC;color:#8C3B14;border-radius:12px;padding:9px 11px;
          font-size:12.5px;line-height:1.4;
        }
        .watch svg{width:14px;height:14px;flex:none;margin-top:1px}
        .tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
        .tags span{
          font-size:11px;font-weight:600;background:var(--sage);color:var(--ink-soft);
          padding:4px 9px;border-radius:99px;
        }
        .acts{display:flex;align-items:center;gap:7px;margin-top:13px}
        button,.link{
          border:0;border-radius:99px;padding:9px 15px;font-size:13px;font-weight:600;
          cursor:pointer;font-family:inherit;text-decoration:none;
          transition:transform 150ms cubic-bezier(.23,1,.32,1);
        }
        button:active,.link:active{transform:scale(.96)}
        button:disabled{opacity:.4;cursor:default}
        .pick{background:var(--coral);color:#fff}
        .more{background:var(--sage);color:var(--ink-soft)}
        .link{background:none;color:var(--ink-faint);margin-left:auto;padding-right:4px}

        @keyframes rise{
          from{opacity:0;transform:translateY(7px) scale(.985)}
          to{opacity:1;transform:none}
        }
      `}</style>
    </div>
  );
}
