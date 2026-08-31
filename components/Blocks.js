// Rendering for the agent's structured content: options to pick between, and
// researched numbers. Tapping an option sends it back as a message, so the
// conversation carries on normally and typing is always still available.

// Anywhere named should be one tap from seeing it. The agent supplies a real
// URL when its research turned one up; when it did not, a Maps search for the
// name is still better than nothing — and it is honest about being a search
// rather than pretending to be the venue's own page.
// (raffy, 2026-08-31: "when it suggest places like in chat, make sure it
// attach a link directly.")
const mapsFor = (name, where) =>
  'https://www.google.com/maps/search/' +
  encodeURIComponent([name, where].filter(Boolean).join(' '));

export default function Block({ block, onChoose, disabled, where }) {
  const { kind, title, intro, items, facts, spots, choose, proposal } = block;

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

      {kind === 'spots' && (spots || []).map((sp, i) => (
        <div key={i} className="opt spot">
          <div className="name">{sp.name}</div>
          <div className="buzz">{sp.buzz}</div>
          {sp.rating && (
            <div className="rating">
              <svg className="star" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.2l5.9-.9z" />
              </svg>
              <span>{sp.rating}</span>
            </div>
          )}
          {sp.meta && <div className="meta">{sp.meta}</div>}
          {sp.best && (
            <div className="best">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
              </svg>
              <span>{sp.best}</span>
            </div>
          )}
          {sp.watch && (
            <div className="watch">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
              <span>{sp.watch}</span>
            </div>
          )}
          {(sp.tags || []).length > 0 && (
            <div className="tags">{sp.tags.map((t) => <span key={t}>{t}</span>)}</div>
          )}
          <div className="acts">
            <button className="pick" disabled={disabled}
              onClick={() => onChoose(`Put ${sp.name} in the trip.`)}>
              Add this
            </button>
            <button className="more" disabled={disabled}
              onClick={() => onChoose(`Tell me more about ${sp.name}.`)}>
              Tell me more
            </button>
          </div>
          <div className="links">
            {sp.link && (
              <a href={sp.link} target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                </svg>
                Their site
              </a>
            )}
            <a href={mapsFor(sp.name, where)} target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" />
              </svg>
              Map
            </a>
          </div>
        </div>
      ))}

      {kind === 'proposal' && proposal && (
        <div className="prop">
          <p className="psum">{proposal.summary}</p>

          <div className="pdays">
            {(proposal.days || []).map((d, i) => (
              <div key={i} className="pday">
                <span className="pl">{d.label}</span>
                <span className="pp">{d.plan}</span>
              </div>
            ))}
          </div>

          {(proposal.stays || []).length > 0 && (
            <div className="prow"><b>Sleeping</b><span>{proposal.stays.join(' → ')}</span></div>
          )}
          {proposal.cost && <div className="prow"><b>Cost</b><span>{proposal.cost}</span></div>}

          {(proposal.unsure || []).length > 0 && (
            <div className="unsure">
              <b>Still worth checking</b>
              <ul>{proposal.unsure.map((u, i) => <li key={i}>{u}</li>)}</ul>
            </div>
          )}

          <div className="acts">
            <button className="pick" disabled={disabled}
              onClick={() => onChoose('That looks right — build it.')}>
              Build my itinerary
            </button>
            <button className="more" disabled={disabled}
              onClick={() => onChoose('Before you build — I want to change something.')}>
              Change something
            </button>
          </div>
        </div>
      )}

      {kind === 'options' && (items || []).map((o, i) => (
        <div key={i} className="opt">
          <div className="top">
            <div className="name">{o.name}</div>
            {o.price && <div className="price">{o.price}</div>}
          </div>
          {o.rating && (
            <div className="rating">
              <svg className="star" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.2l5.9-.9z" />
              </svg>
              <span>{o.rating}</span>
            </div>
          )}
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
          </div>
          <div className="links">
            {o.link && (
              <a href={o.link} target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                </svg>
                Their site
              </a>
            )}
            <a href={mapsFor(o.name, where)} target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" />
              </svg>
              Map
            </a>
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
        /* The rating sits directly under the name because it is the first
           thing anyone looks for when choosing between three places. */
        .rating{
          display:flex;align-items:center;gap:5px;margin-top:5px;
          font-size:12.5px;font-weight:650;color:var(--ink-soft);
        }
        .rating .star{width:13px;height:13px;flex:none;color:#E8A33D}
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
        .spot .buzz{font-size:13.5px;line-height:1.5;margin-top:7px}
        .spot .best{
          display:flex;gap:7px;align-items:center;margin-top:9px;
          font-size:12.5px;color:var(--ink-soft);font-weight:600;
        }
        .spot .best svg{width:14px;height:14px;flex:none;color:var(--deep)}

        /* The proposal is the one card that is the whole trip, so it gets the
           dark treatment — you should be able to tell at a glance that this is
           the thing you are saying yes to. */
        .prop{
          background:var(--deep);color:#E7EFE9;border-radius:22px;
          padding:17px 17px 15px;box-shadow:var(--sh-m);
        }
        .psum{margin:0 0 14px;font-size:13.5px;line-height:1.55;color:#CBDCD0}
        .pdays{display:flex;flex-direction:column;gap:10px;margin-bottom:14px}
        .pday{display:flex;flex-direction:column;gap:2px}
        .pl{font-size:12px;font-weight:750;color:#8FB39C;letter-spacing:.01em}
        .pp{font-size:13.5px;line-height:1.45}
        .prow{
          display:flex;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.12);
          font-size:12.5px;line-height:1.45;
        }
        .prow b{flex:none;width:62px;color:#8FB39C;font-weight:700}
        .prow span{min-width:0;overflow-wrap:anywhere}
        .unsure{
          margin-top:12px;background:rgba(255,255,255,.07);border-radius:14px;padding:11px 13px;
          font-size:12.5px;line-height:1.45;
        }
        .unsure b{color:#E9B99B;font-weight:700}
        .unsure ul{margin:6px 0 0;padding-left:16px}
        .unsure li{margin:3px 0}
        .prop .acts{margin-top:14px}
        .prop .pick{background:#EAF2EC;color:var(--deep)}
        .prop .more{background:rgba(255,255,255,.13);color:#CBDCD0}

        .acts{display:flex;align-items:center;gap:7px;margin-top:13px;flex-wrap:wrap}
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

        /* Links sit in their own quiet row under the buttons. Mixed in with
           them they wrapped, and a link that has wrapped onto its own line
           looks like something went wrong rather than something on offer. */
        .links{
          display:flex;flex-wrap:wrap;gap:14px;align-items:center;
          margin-top:11px;padding-top:11px;border-top:1px solid var(--line);
        }
        .links :global(a),.links a{
          display:inline-flex;align-items:center;gap:6px;padding:0;
          background:none;color:var(--ink-soft);font-size:12.5px;font-weight:650;
          text-decoration:none;
        }
        .links a:hover{color:var(--ink)}
        .links a :global(svg),.links svg{width:13px;height:13px;flex:none;color:var(--ink-faint)}

        @keyframes rise{
          from{opacity:0;transform:translateY(7px) scale(.985)}
          to{opacity:1;transform:none}
        }
      `}</style>
    </div>
  );
}
