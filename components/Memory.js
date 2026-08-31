import { SLOT_LABELS } from '../lib/memory.js';
import { ageNow } from '../lib/memory.js';

// Everything the app remembers, in plain words, with a way to remove each line.
//
// This exists because the alternative is a product that quietly accumulates
// facts about someone's children. If it is going to remember that Nur is three
// and naps early, the person it belongs to has to be able to see that sentence
// and delete it in one tap.

export default function Memory({ memory, onForget, onClearAll }) {
  const rows = [];
  if ((memory.people || []).length) {
    rows.push(['people', 'Travels with', memory.people.map((p) => {
      const a = ageNow(p);
      return p.name + (a != null ? ` (${a})` : '') + (p.note ? ` — ${p.note}` : '');
    }).join(', ')]);
  }
  for (const [k, label] of Object.entries(SLOT_LABELS)) {
    if (k === 'people' || k === 'notes') continue;
    if (memory[k]) rows.push([k, label, memory[k]]);
  }
  if ((memory.notes || []).length) rows.push(['notes', 'Also', memory.notes.join(' · ')]);

  if (!rows.length) return null;

  return (
    <div className="mem">
      {rows.map(([key, label, value]) => (
        <div className="mrow" key={key}>
          <div className="mtext">
            <b>{label}</b>
            <span>{value}</span>
          </div>
          <button className="mx" aria-label={'Forget ' + label.toLowerCase()} onClick={() => onForget(key)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
      <button className="mall" onClick={onClearAll}>Forget everything about me</button>

      <style jsx>{`
        .mem{background:var(--surface);border-radius:14px;padding:4px 4px 8px;box-shadow:var(--sh-s)}
        .mrow{display:flex;align-items:flex-start;gap:6px;padding:8px 8px 8px 10px}
        .mrow + .mrow{border-top:1px solid var(--line)}
        .mtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
        .mtext b{font-size:11px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-faint)}
        .mtext span{font-size:12.5px;line-height:1.45;overflow-wrap:anywhere}
        .mx{
          flex:none;border:0;background:none;color:var(--ink-faint);cursor:pointer;
          width:26px;height:26px;border-radius:8px;display:grid;place-items:center;opacity:.5;
        }
        .mx svg{width:12px;height:12px}
        .mx:hover{opacity:1;background:var(--sage)}
        .mall{
          display:block;width:calc(100% - 12px);margin:4px 6px 0;border:0;background:none;
          color:var(--ink-faint);font-size:11.5px;font-weight:650;cursor:pointer;
          padding:7px;border-radius:9px;font-family:inherit;text-align:left;
        }
        .mall:hover{background:var(--sage);color:#8C3B14}
      `}</style>
    </div>
  );
}
