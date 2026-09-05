// How much is left, at a glance.
//
// raffy, 2026-09-05: "i want it to have like a circular ring thing showing
// credit left and credit spent for each of their chat and build. but make it
// simple they don't have to know the details. just good enough for them to
// know."
//
// So: one ring, two spent arcs, and the number in the middle. No dollars, no
// token counts, no mention of a model — a traveller does not need to know that
// their photos came from Google or that the conversation runs on cached input
// tokens, and telling them makes the app feel like a utility bill.
//
// The two arcs are the only breakdown, because they are the only two things
// that are true from where they sit: they talked to someone, and something got
// built. Everything else is our problem.

const TAU = Math.PI * 2;

// A ring drawn from the top, clockwise, with a gap between the arcs so two
// touching greens do not read as one.
function arc(cx, cy, r, from, to) {
  const a0 = from * TAU - Math.PI / 2;
  const a1 = to * TAU - Math.PI / 2;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2)
    + 'A' + r + ' ' + r + ' 0 ' + (to - from > 0.5 ? 1 : 0) + ' 1 '
    + x1.toFixed(2) + ' ' + y1.toFixed(2);
}

export default function Ring({ credits, size = 128 }) {
  if (!credits) return null;
  const granted = Math.max(1, credits.granted || 0);
  const left = Math.max(0, credits.left || 0);
  const plan = Math.max(0, credits.plan || 0);
  const build = Math.max(0, credits.build || 0);

  // The ledger is the authority on how much is gone; the two parts are a split
  // of it. If they disagree — an old ledger from before the split existed, a
  // rounding edge — the total wins and the remainder goes to planning, which
  // is where almost all of it is.
  const used = Math.max(0, granted - left);
  const known = plan + build;
  const pBuild = known > 0 ? Math.min(used, Math.round(used * (build / known))) : 0;
  const pPlan = used - pBuild;

  const r = size / 2 - 9;
  const c = size / 2;
  const f = (n) => n / granted;
  // A hair of a gap so the join reads as two things, and never a gap wider
  // than the arc it is separating.
  const gap = Math.min(0.012, f(pPlan) / 3, f(pBuild) / 3);

  const nearly = left > 0 && left / granted < 0.15;

  return (
    <div className="ring" style={{ width: size }}>
      <svg viewBox={'0 0 ' + size + ' ' + size} width={size} height={size} aria-hidden="true">
        <circle cx={c} cy={c} r={r} className="rtrack" />
        {pPlan > 0 && <path d={arc(c, c, r, 0, f(pPlan) - (pBuild > 0 ? gap : 0))} className="rplan" />}
        {pBuild > 0 && <path d={arc(c, c, r, f(pPlan) + (pPlan > 0 ? gap : 0), f(pPlan + pBuild))} className="rbuild" />}
      </svg>
      <span className="rmid">
        <b className={nearly ? 'low' : ''}>{left.toLocaleString('en')}</b>
        <i>{left === 0 ? 'none left' : 'credits left'}</i>
      </span>

      <style jsx>{`
        .ring{position:relative;flex:none;display:grid;place-items:center}
        .ring svg{display:block;transform:rotate(0deg)}
        :global(.ring .rtrack){
          fill:none;stroke:rgba(16,54,42,.10);stroke-width:9;
        }
        :global(.ring .rplan),:global(.ring .rbuild){
          fill:none;stroke-width:9;stroke-linecap:round;
          /* Drawn in on first paint. It is a small thing and it is the
             difference between a chart and something that feels alive. */
          animation:ringin 640ms cubic-bezier(.22,.9,.3,1) both;
        }
        :global(.ring .rplan){stroke:#10362A}
        :global(.ring .rbuild){stroke:#C17A3D}
        @keyframes ringin{from{stroke-dasharray:0 999}to{stroke-dasharray:999 0}}
        .rmid{
          position:absolute;inset:0;display:flex;flex-direction:column;
          align-items:center;justify-content:center;gap:1px;pointer-events:none;
        }
        .rmid b{
          font-size:20px;font-weight:700;letter-spacing:-.02em;color:#0C241B;
          font-variant-numeric:tabular-nums;line-height:1;
        }
        .rmid b.low{color:#C17A3D}
        .rmid i{font-style:normal;font-size:10.5px;color:#5A6C63;letter-spacing:.01em}
        @media (prefers-reduced-motion:reduce){
          :global(.ring .rplan),:global(.ring .rbuild){animation:none}
        }
      `}</style>
    </div>
  );
}

/**
 * The ring with its two words beside it. Separate because the drawer wants the
 * pair side by side and the paywall wants the ring alone.
 */
export function Credits({ credits, size = 128 }) {
  if (!credits) return null;
  const granted = Math.max(1, credits.granted || 0);
  const used = Math.max(0, granted - Math.max(0, credits.left || 0));
  const known = (credits.plan || 0) + (credits.build || 0);
  const build = known > 0 ? Math.round(used * ((credits.build || 0) / known)) : 0;
  const plan = used - build;

  return (
    <div className="creds">
      <Ring credits={credits} size={size} />
      <ul className="key">
        <li><i className="kplan" /><span>Planning</span><b>{plan.toLocaleString('en')}</b></li>
        <li><i className="kbuild" /><span>Building</span><b>{build.toLocaleString('en')}</b></li>
      </ul>

      <style jsx>{`
        .creds{display:flex;align-items:center;gap:18px}
        .key{list-style:none;margin:0;padding:0;display:grid;gap:9px;min-width:0}
        .key li{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#4C6157}
        .key i{width:8px;height:8px;border-radius:99px;flex:none}
        .key .kplan{background:#10362A}
        .key .kbuild{background:#C17A3D}
        .key span{flex:1}
        .key b{
          font-weight:700;color:#0C241B;font-variant-numeric:tabular-nums;
          font-size:12.5px;
        }
      `}</style>
    </div>
  );
}
