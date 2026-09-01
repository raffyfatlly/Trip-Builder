import { useState } from 'react';
import { SLOT_LABELS, peopleText, isEmpty } from '../lib/memory.js';

// The traveller's own profile.
//
// This is the same store the agent writes to when it learns something durable
// — there is deliberately only one. A separate "profile" alongside the
// remembered facts would mean two answers to "how old is Nur", and they would
// disagree inside a week.
//
// So: the agent fills most of it in from conversation, and every line is
// editable here, because it describes them and they should have the last word.
// Tap a row to correct it; the × forgets it entirely.

const PLACEHOLDERS = {
  name: 'What should I call you?',
  people: 'Aisyah, Adam (6), Nur (3) — naps early',
  home: 'Kuala Lumpur',
  dietary: 'Halal, no shellfish',
  pace: 'Slow, one thing a day',
  interests: 'Beaches, food, keeping the kids happy',
  budget: 'Around RM400 a night',
  notes: 'Anything else worth knowing next time',
};

// Shown even when blank, so there is something to fill in on a first visit.
const ALWAYS = ['name', 'people', 'home', 'dietary'];

export default function Profile({ memory, onEdit, onForget, onClearAll }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');

  const m = memory || {};
  const valueOf = (key) => {
    if (key === 'people') return peopleText(m.people);
    if (key === 'notes') return (m.notes || []).join(' · ');
    return m[key] || '';
  };

  const keys = Object.keys(SLOT_LABELS).filter((k) => ALWAYS.includes(k) || valueOf(k));

  const start = (key) => { setEditing(key); setDraft(valueOf(key)); };
  const commit = () => {
    if (editing && draft.trim() && draft.trim() !== valueOf(editing)) onEdit(editing, draft);
    setEditing(null);
  };

  return (
    <div className="prof">
      {keys.map((key) => {
        const val = valueOf(key);
        return (
          <div className={'prow' + (val ? '' : ' blank')} key={key}>
            <div className="ptext">
              <b>{SLOT_LABELS[key]}</b>
              {editing === key ? (
                <input
                  autoFocus
                  value={draft}
                  placeholder={PLACEHOLDERS[key]}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commit(); }
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <button className="pval" onClick={() => start(key)}>
                  {val || <i>{PLACEHOLDERS[key]}</i>}
                </button>
              )}
            </div>
            {val && editing !== key && (
              <button className="px" aria-label={'Forget ' + SLOT_LABELS[key].toLowerCase()}
                onClick={() => onForget(key)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        );
      })}

      {!isEmpty(m) && (
        <button className="pall" onClick={onClearAll}>Forget everything about me</button>
      )}

      <style jsx>{`
        .prof{padding:2px 0}
        .prow{display:flex;align-items:flex-start;gap:6px;padding:8px 8px 8px 10px}
        .prow + .prow{border-top:1px solid var(--line)}
        .ptext{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
        .ptext b{
          font-size:11px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;
          color:var(--ink-faint);
        }
        .pval{
          border:0;background:none;padding:0;text-align:left;font-family:inherit;
          font-size:12.5px;line-height:1.45;color:var(--ink);cursor:text;
          overflow-wrap:anywhere;width:100%;
        }
        .pval i{font-style:normal;color:var(--ink-faint)}
        .prow.blank .pval{color:var(--ink-faint)}
        input{
          width:100%;border:0;background:var(--bg);border-radius:9px;
          padding:7px 9px;font-size:13px;font-family:inherit;color:var(--ink);outline:none;
        }
        input:focus{box-shadow:0 0 0 2px var(--deep)}
        .px{
          flex:none;border:0;background:none;color:var(--ink-faint);cursor:pointer;
          width:26px;height:26px;border-radius:8px;display:flex;align-items:center;
          justify-content:center;opacity:.5;padding:0;
        }
        .px svg{width:12px;height:12px;display:block}
        .px:hover{opacity:1;background:var(--sage)}
        .pall{
          display:block;width:calc(100% - 12px);margin:4px 6px 0;border:0;background:none;
          color:var(--ink-faint);font-size:11.5px;font-weight:650;cursor:pointer;
          padding:7px;border-radius:9px;font-family:inherit;text-align:left;
        }
        .pall:hover{background:var(--sage);color:#8C3B14}
      `}</style>
    </div>
  );
}
