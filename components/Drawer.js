import { shortDate } from '../lib/trips.js';

// The menus, given room to breathe.
//
// Everything used to live in the header: the wordmark, the itinerary button,
// and a dropdown holding trips and New trip. At 390px that is three tap
// targets and a title fighting over about 350 pixels, and it looked it. The
// header now carries one control and a title; everything else slides in from
// the left with space to be legible.

export default function Drawer({ open, onClose, trips, session, onOpenTrip, onDrop, onNew, onDownload, canDownload }) {
  return (
    <>
      <div className={'veil' + (open ? ' on' : '')} onClick={onClose} aria-hidden={!open} />
      <aside className={'drawer' + (open ? ' on' : '')} aria-hidden={!open}>
        <div className="dhead">
          <div className="brand">
            <span className="dot" />
            <span>Trip builder</span>
          </div>
          <button className="close" onClick={onClose} aria-label="Close menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="dscroll">
          {trips.length > 0 && (
            <>
              <h3>Your trips</h3>
              <div className="list">
                {trips.map((t) => (
                  <div key={t.id} className={'row' + (t.id === session ? ' on' : '')}>
                    <button className="pick" onClick={() => onOpenTrip(t.id)}>
                      <span className="lbl">{t.label}</span>
                      <span className="when">{t.id === session ? 'Open now' : shortDate(t.at)}</span>
                    </button>
                    {t.id !== session && (
                      <button className="x" aria-label={'Remove ' + t.label} onClick={() => onDrop(t.id)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          <h3>Start</h3>
          <button className="act" onClick={onNew}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span><b>New trip</b><i>Plan somewhere else</i></span>
          </button>

          {canDownload && (
            <button className="act" onClick={onDownload}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" />
              </svg>
              <span><b>Download</b><i>Keep this itinerary offline</i></span>
            </button>
          )}
        </div>

        <p className="foot">Trips are kept on this device.</p>
      </aside>

      <style jsx>{`
        .veil{
          position:fixed;inset:0;z-index:50;background:rgba(12,36,27,.34);
          opacity:0;pointer-events:none;transition:opacity 260ms var(--e);
          backdrop-filter:blur(2px);
        }
        .veil.on{opacity:1;pointer-events:auto}

        .drawer{
          position:fixed;top:0;bottom:0;left:0;z-index:51;
          width:min(86vw,320px);display:flex;flex-direction:column;
          background:var(--bg);box-shadow:var(--sh-l);
          transform:translateX(-102%);transition:transform 300ms var(--e);
          padding:calc(14px + env(safe-area-inset-top)) 0 calc(10px + env(safe-area-inset-bottom));
        }
        .drawer.on{transform:none}

        .dhead{display:flex;align-items:center;justify-content:space-between;padding:0 16px 18px}
        .brand{display:flex;align-items:center;gap:9px;font-weight:700;font-size:15px}
        .dot{width:11px;height:11px;border-radius:99px;background:var(--coral);flex:none}
        .close{
          border:0;background:var(--surface);color:var(--ink-soft);cursor:pointer;
          width:32px;height:32px;border-radius:99px;display:grid;place-items:center;
          box-shadow:var(--sh-s);
        }
        .close svg{width:15px;height:15px}

        .dscroll{flex:1;min-height:0;overflow-y:auto;padding:0 12px}
        h3{
          margin:6px 4px 8px;font-size:11px;font-weight:750;letter-spacing:.07em;
          text-transform:uppercase;color:var(--ink-faint);
        }
        .list{display:flex;flex-direction:column;gap:2px;margin-bottom:20px}
        .row{display:flex;align-items:center;border-radius:13px}
        .row.on{background:var(--sage)}
        .pick{
          flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;align-items:flex-start;
          border:0;background:none;cursor:pointer;text-align:left;color:inherit;
          padding:11px 12px;border-radius:13px;font-family:inherit;
        }
        .row:not(.on) .pick:hover{background:var(--surface)}
        .lbl{
          font-size:14px;font-weight:650;line-height:1.25;max-width:100%;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        }
        .when{font-size:11.5px;color:var(--ink-soft);font-weight:600}
        .x{
          flex:none;border:0;background:none;color:var(--ink-faint);cursor:pointer;
          width:30px;height:30px;margin-right:6px;border-radius:9px;
          display:grid;place-items:center;opacity:.55;
        }
        .x svg{width:13px;height:13px}
        .x:hover{opacity:1;background:var(--surface)}

        .act{
          display:flex;align-items:center;gap:12px;width:100%;margin-bottom:6px;
          border:0;background:var(--surface);cursor:pointer;color:inherit;
          padding:12px 13px;border-radius:14px;box-shadow:var(--sh-s);
          font-family:inherit;text-align:left;
          transition:transform 150ms var(--e);
        }
        .act:active{transform:scale(.985)}
        .act svg{width:17px;height:17px;flex:none;color:var(--deep)}
        .act span{display:flex;flex-direction:column;gap:2px;min-width:0}
        .act b{font-size:14px;font-weight:650}
        .act i{font-style:normal;font-size:11.5px;color:var(--ink-soft)}

        .foot{margin:10px 18px 0;font-size:11px;color:var(--ink-faint)}

        @media (prefers-reduced-motion:reduce){
          .drawer{transition:none}
        }
      `}</style>
    </>
  );
}
