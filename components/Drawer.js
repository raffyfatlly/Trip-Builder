import { useState, useEffect } from 'react';
import { shortDate } from '../lib/trips.js';
import Account from './Account.js';
import Profile from './Profile.js';
import { peopleText } from '../lib/memory.js';

// The menus, given room to breathe.
//
// Everything used to live in the header: the wordmark, the itinerary button,
// and a dropdown holding trips and New trip. At 390px that is three tap
// targets and a title fighting over about 350 pixels, and it looked it. The
// header now carries one control and a title; everything else slides in from
// the left with space to be legible.

export default function Drawer({ open, onClose, trips, session, onOpenTrip, onDrop, onNew, onDownload, canDownload,
                                accounts, user, onSignedIn, onSignOut,
                                memory, onEditSlot, onForgetSlot, onForgetAll,
                                nudge, onNudgeSave, onNudgeLater }) {
  // Which trip is being removed, if any. Inline rather than a dialog: the row
  // is where the mistake would happen, so that is where the second look
  // belongs — and it keeps the trip's name in front of you while you decide.
  const [confirming, setConfirming] = useState(null);
  const [profOpen, setProfOpen] = useState(false);

  // A one-line sense of what is in there, so the row is worth tapping.
  const profSummary = (() => {
    const m = memory || {};
    const bits = [];
    if ((m.people || []).length) bits.push(peopleText(m.people));
    for (const k of ['home', 'dietary']) if (m[k]) bits.push(m[k]);
    return bits.join(' · ').slice(0, 60);
  })();

  // Closing the drawer abandons the question rather than leaving it armed for
  // whenever it is opened again.
  useEffect(() => { if (!open) { setConfirming(null); setProfOpen(false); } }, [open]);

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
          {/* One identity row, folded shut. raffy, 2026-09-01: "for profile i
              prefer it we click the account and expand. not live in side bar."
              So the account IS the profile — tapping it opens who you are,
              what is remembered about you, and signing in, in that order.
              A drawer that opens onto somebody's family every time is the
              wrong weight for reference material. */}
          <div className="memwrap">
            <button className="proftoggle" onClick={() => setProfOpen((v) => !v)} aria-expanded={profOpen}>
              <span className="profav">
                {user ? (user.email || '?')[0].toUpperCase() : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21a8 8 0 1 0-16 0" /><circle cx="12" cy="8" r="4" />
                  </svg>
                )}
              </span>
              <span className="proftext">
                <b>{(memory && memory.name) || (user && user.email) || 'Your profile'}</b>
                <i>{profSummary || (user ? user.email : 'Nothing saved yet')}</i>
              </span>
              <svg className="profchev" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.4" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
            </button>

            {profOpen && (
              <div className="profbody">
                <Profile
                  memory={memory}
                  onEdit={onEditSlot}
                  onForget={onForgetSlot}
                  onClearAll={onForgetAll}
                />
                {accounts && (
                  <Account user={user} trips={trips} onSignedIn={onSignedIn} onSignOut={onSignOut} />
                )}
              </div>
            )}
            {/* Asked once the profile is worth keeping, and again only after
                it has grown — nagging on every change is how a prompt gets
                dismissed permanently. Never a wall: everything works signed
                out, this only makes it follow them. */}
            {nudge && (
              <div className="saveme">
                <span>Keep this? Save it and your trips and details follow you to any device.</span>
                <div className="keeprow">
                  <button className="later" onClick={onNudgeLater}>Not now</button>
                  <button className="now" onClick={onNudgeSave}>Save profile</button>
                </div>
              </div>
            )}
          </div>

          {trips.length > 0 && (
            <>
              <h3>Your trips</h3>
              <div className="list">
                {trips.map((t) => (
                  confirming === t.id ? (
                    <div key={t.id} className="row confirm">
                      <div className="ask">
                        <b>Remove {t.label}?</b>
                        <span>It comes off this list. The trip itself is not deleted.</span>
                      </div>
                      <div className="askrow">
                        <button className="keep" onClick={() => setConfirming(null)}>Keep it</button>
                        <button
                          className="go"
                          onClick={() => { onDrop(t.id); setConfirming(null); }}
                        >Remove</button>
                      </div>
                    </div>
                  ) : (
                    <div key={t.id} className={'row' + (t.id === session ? ' on' : '')}>
                      <button className="pick" onClick={() => onOpenTrip(t.id)}>
                        <span className="lbl">{t.label}</span>
                        <span className="when">{t.id === session ? 'Open now' : shortDate(t.at)}</span>
                      </button>
                      {t.id !== session && (
                        <button className="x" aria-label={'Remove ' + t.label} onClick={() => setConfirming(t.id)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )
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

        <p className="foot">
          {user ? 'Signed in — your trips follow you.' : 'Trips are kept on this device.'}
        </p>
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

        .row.confirm{
          flex-direction:column;align-items:stretch;gap:10px;
          background:var(--surface);box-shadow:var(--sh-s);padding:12px;
          animation:rise 200ms var(--e) both;
        }
        .ask{display:flex;flex-direction:column;gap:3px}
        .ask b{font-size:13.5px;font-weight:650;line-height:1.3}
        .ask span{font-size:11.5px;line-height:1.4;color:var(--ink-soft)}
        .askrow{display:flex;gap:7px}
        .askrow button{
          flex:1;border:0;border-radius:99px;padding:9px 12px;font-size:12.5px;
          font-weight:650;cursor:pointer;font-family:inherit;
        }
        .keep{background:var(--sage);color:var(--ink-soft)}
        .go{background:#8C3B14;color:#FBE6DC}
        @keyframes rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}

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

        .memwrap{margin-bottom:20px}
        .proftoggle{
          display:flex;align-items:center;gap:11px;width:100%;
          border:0;background:var(--surface);cursor:pointer;color:inherit;
          padding:11px 12px;border-radius:14px;box-shadow:var(--sh-s);
          font-family:inherit;text-align:left;
          transition:transform 150ms var(--e);
        }
        .proftoggle:active{transform:scale(.985)}
        .profav{
          flex:none;width:30px;height:30px;border-radius:99px;background:var(--sage);
          color:var(--deep);display:grid;place-items:center;font-weight:700;font-size:13px;
        }
        .profav svg{width:16px;height:16px}
        .profbody{
          margin-top:6px;background:var(--surface);border-radius:14px;
          padding:6px;box-shadow:var(--sh-s);animation:rise 200ms var(--e) both;
        }
        .proftext{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
        .proftext b{font-size:14px;font-weight:650}
        .proftext i{
          font-style:normal;font-size:11.5px;color:var(--ink-soft);
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        }
        .profchev{
          width:14px !important;height:14px !important;color:var(--ink-faint) !important;
          transition:transform 200ms var(--e);
        }
        .proftoggle[aria-expanded="true"] .profchev{transform:rotate(180deg)}
        .saveme{
          margin-top:8px;background:var(--sage);border-radius:13px;padding:11px 12px;
          font-size:12px;line-height:1.45;color:var(--ink-soft);
        }
        .keeprow{display:flex;gap:7px;margin-top:9px}
        .keeprow button{
          border:0;border-radius:99px;padding:8px 13px;font-size:12px;font-weight:650;
          cursor:pointer;font-family:inherit;
        }
        .later{background:none;color:var(--ink-faint)}
        .now{flex:1;background:var(--deep);color:#EAF2EC}
        .foot{margin:10px 18px 0;font-size:11px;color:var(--ink-faint)}

        @media (prefers-reduced-motion:reduce){
          .drawer{transition:none}
        }
      `}</style>
    </>
  );
}
