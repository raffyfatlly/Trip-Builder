import { useEffect, useState } from 'react';

// What the builder has actually finished, while it is still working.
//
// raffy, 2026-09-06: "Enable users to click into the app interface even while
// it is still being generated. Provide a visual progress state with active
// updates (e.g. checking off structure, images, and map generation) to prevent
// blind waiting."
//
// The bar this replaces moved on a step count — honest, but it only ever said
// "7 of 14", which tells a traveller nothing about their trip. These stages are
// read off the half-written itinerary itself, so every tick is a fact about
// something that now exists, and the preview underneath is showing it.
//
// Deliberately NOT a timer and NOT a fixed script. A stage ticks when its data
// is there. If the builder does them out of order, the list says so.

const STAGES = [
  {
    key: 'shape',
    label: 'The shape of your trip',
    done: (it) => !!(it && it.trip && it.trip.title),
  },
  {
    key: 'days',
    label: 'Your days',
    done: (it) => ((it && it.days) || []).length > 0,
    count: (it) => ((it && it.days) || []).length,
    unit: (n) => (n === 1 ? 'day' : 'days'),
  },
  {
    key: 'stays',
    label: 'Where you sleep',
    done: (it) => ((it && it.stays) || []).length > 0,
    count: (it) => ((it && it.stays) || []).length,
    unit: (n) => (n === 1 ? 'stay' : 'stays'),
  },
  {
    key: 'items',
    label: 'What you do each day',
    done: (it) => ((it && it.days) || []).some((d) => ((d && d.items) || []).length > 0),
    count: (it) => ((it && it.days) || []).reduce((n, d) => n + ((d && d.items) || []).length, 0),
    unit: (n) => (n === 1 ? 'thing' : 'things'),
  },
  {
    key: 'photos',
    label: 'Photographs',
    done: (it) => Object.keys((it && it.photos) || {}).length > 0,
    count: (it) => Object.keys((it && it.photos) || {}).length,
    unit: (n) => (n === 1 ? 'photo' : 'photos'),
  },
  {
    key: 'map',
    label: 'The map',
    done: (it) => ((it && it.stays) || []).some((s) => isFinite(+(s && s.lat)) && isFinite(+(s && s.lon))),
  },
];

// Long waits need something that is moving even when nothing has landed for a
// minute, or the screen reads as frozen. This is the only animated thing here,
// and it sits on the stage being worked on rather than pretending to measure it.
function Dots() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((v) => (v + 1) % 3), 420);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="dots" aria-hidden="true">
      {[0, 1, 2].map((i) => <i key={i} className={i === n ? 'on' : ''} />)}
      <style jsx>{`
        .dots{display:inline-flex;gap:3px;align-items:center;margin-left:6px}
        i{width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.28;
          transition:opacity 200ms ease}
        i.on{opacity:.85}
      `}</style>
    </span>
  );
}

export default function Progress({ itinerary, progress, compact }) {
  const it = itinerary || null;
  const state = STAGES.map((s) => ({ ...s, ok: !!s.done(it) }));
  const doneCount = state.filter((s) => s.ok).length;
  // The one being worked on is the first that has not landed. Once they have
  // all landed the builder is finishing off — say that rather than showing six
  // ticks and no explanation for why it is still going.
  const active = state.findIndex((s) => !s.ok);

  return (
    <div className={'prog' + (compact ? ' compact' : '')}>
      <div className="phead">
        <span className="ptitle">
          {active === -1 ? 'Finishing your trip' : 'Building your trip'}
        </span>
        <span className="pcount">{doneCount} of {STAGES.length}</span>
      </div>

      <ul>
        {state.map((s, i) => {
          const n = s.count ? s.count(it) : 0;
          return (
            <li key={s.key} className={s.ok ? 'ok' : i === active ? 'now' : 'wait'}>
              <span className="mark" aria-hidden="true">
                {s.ok ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12.5 4.5 4.5L19 7" />
                  </svg>
                ) : null}
              </span>
              <span className="lab">{s.label}</span>
              {s.ok && n > 0 && <span className="n">{n} {s.unit(n)}</span>}
              {i === active && <Dots />}
            </li>
          );
        })}
      </ul>

      {/* Kept underneath, because the stages say WHAT and this says HOW FAR.
          It moves when the builder moves, never on a timer. */}
      {progress && progress.steps > 0 && (
        <div className="bbar" role="progressbar"
          aria-valuenow={progress.step} aria-valuemin={0} aria-valuemax={progress.steps}>
          <i style={{ width: Math.min(97, Math.round((progress.step / progress.steps) * 100)) + '%' }} />
        </div>
      )}

      <p className="foot">It keeps going if you close this — come back any time.</p>

      <style jsx>{`
        .prog{
          width:100%;max-width:340px;text-align:left;
          background:var(--surface);border:1px solid var(--line);border-radius:14px;
          padding:14px 15px 12px;box-shadow:var(--sh-s);
        }
        .prog.compact{max-width:none;border-radius:0;border:0;border-bottom:1px solid var(--line);
          box-shadow:none;padding:10px 14px 9px}
        .phead{display:flex;align-items:baseline;justify-content:space-between;gap:10px;
          margin-bottom:9px}
        .ptitle{font-size:13px;font-weight:750;color:var(--ink)}
        .pcount{font-size:11px;font-weight:650;color:var(--ink-faint);
          font-variant-numeric:tabular-nums}
        ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1px}
        .prog.compact ul{flex-direction:row;flex-wrap:wrap;gap:2px 12px}
        li{display:flex;align-items:center;gap:7px;font-size:12.5px;line-height:1.9;
          color:var(--ink-faint);transition:color 200ms ease}
        li.ok{color:var(--ink)}
        li.now{color:var(--ink);font-weight:650}
        .mark{width:14px;height:14px;flex:none;border-radius:50%;display:inline-flex;
          align-items:center;justify-content:center;border:1.5px solid var(--line);
          color:#fff;transition:background 200ms ease,border-color 200ms ease}
        li.ok .mark{background:var(--deep);border-color:var(--deep)}
        li.now .mark{border-color:var(--coral)}
        .mark svg{width:9px;height:9px}
        .lab{min-width:0}
        .n{font-size:11px;font-weight:650;color:var(--ink-faint);
          background:var(--sage);border-radius:20px;padding:1px 7px;
          font-variant-numeric:tabular-nums}
        .bbar{margin-top:11px;height:4px;border-radius:4px;background:var(--sage);overflow:hidden}
        .bbar i{display:block;height:100%;background:var(--deep);border-radius:4px;
          transition:width 600ms cubic-bezier(.23,1,.32,1)}
        .foot{margin:9px 0 0;font-size:11px;color:var(--ink-faint);line-height:1.45}
        .prog.compact .foot{display:none}
      `}</style>
    </div>
  );
}
