import { useState } from 'react';
import { SLOTS, filled, missing } from '../lib/plan.js';

// What the agent has settled so far, and what it is still working on.
//
// The build now comes at the END of the conversation rather than after four
// facts, which is right for the itinerary and wrong for the nerves: without
// this, several minutes of good research just looks like nothing happening.
// So the same checklist the agent works to is visible to the traveller.
//
// It sits in the flow above the conversation. Nothing here floats over the
// chat — an earlier version of the itinerary button did, and it covered the
// last thing the agent said.

// Whether the checklist starts open. Their choice, remembered.
const OPEN_KEY = 'tb.plan.open.v1';
const startOpen = () => {
  try {
    const v = localStorage.getItem(OPEN_KEY);
    return v === null ? true : v === '1';
  } catch (e) { return true; }
};

export default function Plan({ plan, onBuild, built, building }) {
  // Open by default now.
  //
  // raffy, 2026-09-05: "I think the planning tab (the 6 out of 7) etc should
  // open much early so user also can track at which phase they are at."
  //
  // It was collapsed, so the phases were behind a tap nobody knew to make and
  // the bar was just a number. Open, it is the map of the conversation: what
  // has been settled, what is still coming. Collapsing it is remembered, so
  // anyone who finds it in the way only has to say so once.
  const [open, setOpen] = useState(startOpen);
  const toggle = () => setOpen((v) => {
    try { localStorage.setItem(OPEN_KEY, v ? '0' : '1'); } catch (e) { /* private mode */ }
    return !v;
  });
  const have = filled(plan);
  const left = missing(plan);

  // Nothing settled yet: the conversation has barely started, and an empty
  // checklist is just noise.
  if (!have.length || built) return null;

  const done = !left.length;

  return (
    <div className={'plan' + (open ? ' open' : '')}>
      <button className="planbar" onClick={toggle} aria-expanded={open}>
        <span className="dots">
          {SLOTS.map((s) => <i key={s.key} className={plan[s.key] ? 'on' : ''} />)}
        </span>
        <span className="ptext">
          {done ? 'Ready to build' : `Planning · ${have.length} of ${SLOTS.length}`}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="planlist">
          {SLOTS.map((s) => (
            <div key={s.key} className={'slot' + (plan[s.key] ? ' got' : '')}>
              <span className="tick">{plan[s.key] ? '✓' : ''}</span>
              <span className="sk">{s.label}</span>
              <span className="sv">{plan[s.key] || s.hint}</span>
            </div>
          ))}
          {!building && (
            <button className="buildnow" onClick={onBuild}>
              {done ? 'Build my itinerary' : `Build it anyway (${left.length} still open)`}
            </button>
          )}
        </div>
      )}

      <style jsx>{`
        .plan{
          flex:none;background:var(--surface);border-radius:16px;
          box-shadow:var(--sh-s);margin:0 2px 10px;overflow:hidden;
        }
        .planbar{
          display:flex;align-items:center;gap:10px;width:100%;
          border:0;background:none;cursor:pointer;color:inherit;
          padding:11px 13px;text-align:left;font-family:inherit;
        }
        .dots{display:flex;gap:3px;flex:none}
        .dots i{
          width:6px;height:6px;border-radius:99px;background:var(--line);
          transition:background 260ms var(--e);
        }
        .dots i.on{background:var(--deep)}
        .ptext{flex:1;min-width:0;font-size:13px;font-weight:650;color:var(--ink-soft)}
        .planbar svg{
          width:14px;height:14px;flex:none;color:var(--ink-faint);
          transition:transform 220ms var(--e);
        }
        .plan.open .planbar svg{transform:rotate(180deg)}

        .planlist{padding:0 13px 12px;animation:rise 220ms var(--e) both}
        .slot{
          display:grid;grid-template-columns:16px 62px 1fr;gap:8px;align-items:baseline;
          padding:6px 0;border-top:1px solid var(--line);
        }
        .tick{font-size:11px;color:var(--deep);font-weight:800}
        .sk{font-size:12px;font-weight:700;color:var(--ink-soft)}
        .sv{font-size:12.5px;line-height:1.4;color:var(--ink-faint);min-width:0;overflow-wrap:anywhere}
        .slot.got .sv{color:var(--ink)}

        .buildnow{
          width:100%;margin-top:12px;border:0;background:var(--deep);color:#EAF2EC;
          font-size:13.5px;font-weight:650;padding:12px 16px;border-radius:99px;
          cursor:pointer;font-family:inherit;transition:transform 160ms var(--e);
        }
        .buildnow:active{transform:scale(.985)}
      `}</style>
    </div>
  );
}
