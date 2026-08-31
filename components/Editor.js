import { useState } from 'react';
import { blankItem } from '../lib/edits.js';
import PhotoPick from './PhotoPick.js';

// Manual editing of the itinerary: add, change, delete, reorder by time, and
// confirm a stay. Every change is a local operation — no API call, no cost,
// no waiting.

function Field({ label, value, onChange, placeholder, rows }) {
  return (
    <label className="field">
      <span>{label}</span>
      {rows ? (
        <textarea rows={rows} value={value || ''} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input value={value || ''} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} />
      )}
      <style jsx>{`
        .field{display:block;margin-bottom:13px}
        .field span{
          display:block;font-size:11.5px;font-weight:700;letter-spacing:.05em;
          text-transform:uppercase;color:var(--ink-faint);margin-bottom:6px;
        }
        input,textarea{
          width:100%;border:0;background:var(--sage);border-radius:14px;
          padding:11px 13px;font-size:15px;font-family:inherit;color:var(--ink);
          outline:0;resize:vertical;line-height:1.5;
        }
        input:focus,textarea:focus{box-shadow:0 0 0 2px var(--coral)}
      `}</style>
    </label>
  );
}

function ItemEditor({ item, onSave, onDelete, onCancel, photo, onPhoto, onPhotoClear }) {
  const [draft, setDraft] = useState({ ...item });
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  const tags = (draft.tags || []).join(', ');

  return (
    <div className="ed">
      <Field label="Time" value={draft.t} onChange={set('t')} placeholder="3:00pm, or ~4:00pm" />
      <Field label="What" value={draft.h} onChange={set('h')} placeholder="Check in to the hotel" />
      <Field label="Notes" value={draft.p} onChange={set('p')} rows={4}
        placeholder="What it is, why it is worth doing, anything to watch out for" />
      <Field label="Tags, comma separated" value={tags}
        onChange={(v) => setDraft((d) => ({
          ...d, tags: v.split(',').map((s) => s.trim()).filter(Boolean),
        }))}
        placeholder="Photo spot, Booked" />

      {onPhoto && (
        <div className="pw">
          <span className="pl">Photo</span>
          <PhotoPick current={photo} onSet={onPhoto} onClear={onPhotoClear} />
        </div>
      )}

      <label className="tog">
        <input type="checkbox" checked={!!draft.out}
          onChange={(e) => set('out')(e.target.checked)} />
        <span>Outdoors <em>shows a weather note for this time</em></span>
      </label>

      <div className="row">
        <button className="save" onClick={() => onSave(draft)}>Save</button>
        <button className="cancel" onClick={onCancel}>Cancel</button>
        {onDelete && <button className="del" onClick={onDelete}>Delete</button>}
      </div>

      <style jsx>{`
        .ed{
          background:var(--surface);border-radius:20px;padding:17px;
          box-shadow:var(--sh-m);margin:9px 0;
        }
        .pw{margin:2px 0 16px}
        .pl{
          display:block;font-size:11px;font-weight:750;letter-spacing:.06em;
          text-transform:uppercase;color:var(--ink-faint);
        }
        .tog{display:flex;align-items:flex-start;gap:10px;margin:4px 0 16px;cursor:pointer}
        .tog input{width:19px;height:19px;flex:none;margin-top:1px;accent-color:var(--coral)}
        .tog span{font-size:14px;line-height:1.4}
        .tog em{display:block;font-style:normal;font-size:12.5px;color:var(--ink-faint)}
        .row{display:flex;gap:8px}
        button{
          border:0;border-radius:99px;padding:11px 18px;font-size:14px;font-weight:600;
          cursor:pointer;font-family:inherit;transition:transform 150ms var(--e);
        }
        button:active{transform:scale(.96)}
        .save{background:var(--coral);color:#fff}
        .cancel{background:var(--sage);color:var(--ink-soft)}
        .del{background:none;color:#A33A17;margin-left:auto}
      `}</style>
    </div>
  );
}

export default function Editor({ itinerary, onOp }) {
  const photos = itinerary.photos || {};
  const srcOf = (o) => (o && o.photo ? photos[o.photo] : '') || '';
  const [day, setDay] = useState(0);
  const [editing, setEditing] = useState(null);   // item index, or 'new'

  const days = itinerary.days || [];
  const d = days[day];
  if (!d) return null;
  const items = d.items || [];

  const close = () => setEditing(null);

  return (
    <div className="editor">
      <div className="strip">
        {days.map((x, i) => (
          <button key={i} className={'chip' + (i === day ? ' on' : '')}
            onClick={() => { setDay(i); close(); }}>
            <span className="w">{x.dow}</span>
            <span className="n">{x.dom}</span>
          </button>
        ))}
      </div>

      <div className="head">
        <h3>{d.title}</h3>
        <p>{d.sub}</p>
      </div>

      {items.map((it, i) => (
        editing === i ? (
          <ItemEditor
            key={i}
            item={it}
            onSave={(patch) => {
              onOp({ type: 'item.update', day, id: it._id, was: it.h, patch });
              close();
            }}
            onDelete={() => {
              onOp({ type: 'item.delete', day, id: it._id, was: it.h });
              close();
            }}
            onCancel={close}
            photo={srcOf(it)}
            onPhoto={(url, credit) =>
              onOp({ type: 'photo.set', target: 'item', day, id: it._id, url, credit })}
            onPhotoClear={() => onOp({ type: 'photo.clear', target: 'item', day, id: it._id })}
          />
        ) : (
          <button key={i} className="card" onClick={() => setEditing(i)}>
            <div className="t">{it.t || 'no time'}</div>
            <div className="body">
              <div className="h">{it.h}</div>
              {it.p && <div className="p">{it.p}</div>}
              {(it.tags || []).length > 0 && (
                <div className="tags">
                  {it.tags.map((t) => <span key={t}>{t}</span>)}
                </div>
              )}
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
          </button>
        )
      ))}

      {editing === 'new' ? (
        <ItemEditor
          item={blankItem()}
          onSave={(item) => {
            // A fresh id, so later edits to this item address it stably.
            onOp({ type: 'item.add', day, id: 'a' + Date.now().toString(36), item });
            close();
          }}
          onCancel={close}
        />
      ) : (
        <button className="add" onClick={() => setEditing('new')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          Add something to this day
        </button>
      )}

      <div className="pics">
        <h4>Photos</h4>

        <div className="picrow">
          <div className="picname">Feature card</div>
          <PhotoPick
            current={srcOf((itinerary.trip || {}).feature)}
            onSet={(url, credit) => onOp({ type: 'photo.set', target: 'feature', url, credit })}
            onClear={() => onOp({ type: 'photo.clear', target: 'feature' })}
          />
        </div>

        {(itinerary.stays || []).map((s, i) => (
          <div className="picrow" key={i}>
            <div className="picname">{s.n || s.name || 'Stay ' + (i + 1)}</div>
            <PhotoPick
              current={srcOf(s)}
              onSet={(url, credit) => onOp({ type: 'photo.set', target: 'stay', index: i, url, credit })}
              onClear={() => onOp({ type: 'photo.clear', target: 'stay', index: i })}
            />
          </div>
        ))}
      </div>

      {(itinerary.stays || []).some((s) => s.draft) && (
        <div className="stays">
          <h4>Not booked yet</h4>
          {(itinerary.stays || []).map((s, i) => s.draft ? (
            <div key={i} className="stayrow">
              <span>{s.n}</span>
              <button onClick={() => onOp({
                type: 'stay.update', index: i, patch: { draft: false },
              })}>Confirm</button>
            </div>
          ) : null)}
        </div>
      )}

      <style jsx>{`
        .editor{padding-bottom:26px}
        .pics{margin-top:22px}
        .pics h4{
          margin:0 2px 10px;font-size:11px;font-weight:750;letter-spacing:.07em;
          text-transform:uppercase;color:var(--ink-faint);
        }
        .picrow{
          background:var(--surface);border-radius:16px;padding:12px 13px;
          box-shadow:var(--sh-s);margin-bottom:8px;
        }
        .picname{font-size:13.5px;font-weight:650}
        .strip{
          display:flex;gap:8px;overflow-x:auto;padding:2px 0 14px;
          scrollbar-width:none;
        }
        .strip::-webkit-scrollbar{display:none}
        .chip{
          flex:none;border:0;background:var(--surface);border-radius:16px;
          padding:9px 13px;text-align:center;cursor:pointer;box-shadow:var(--sh-s);
          font-family:inherit;transition:transform 150ms var(--e);
        }
        .chip:active{transform:scale(.95)}
        .chip.on{background:var(--deep);color:#EAF2EC}
        .chip .w{display:block;font-size:10px;font-weight:700;letter-spacing:.06em;opacity:.7}
        .chip .n{display:block;font-size:18px;font-weight:700;line-height:1.15}

        .head{margin:4px 0 14px}
        .head h3{margin:0;font-family:'Outfit',sans-serif;font-size:23px;font-weight:700}
        .head p{margin:4px 0 0;font-size:13.5px;color:var(--ink-faint)}

        .card{
          display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;
          border:0;background:var(--surface);border-radius:18px;padding:14px;
          margin-bottom:9px;box-shadow:var(--sh-s);cursor:pointer;font-family:inherit;
          transition:transform 150ms var(--e);
        }
        .card:active{transform:scale(.99)}
        .card .t{
          flex:none;font-size:12.5px;font-weight:700;color:var(--coral-text,#AE4715);
          background:var(--sage);padding:5px 9px;border-radius:99px;
        }
        .card .body{flex:1;min-width:0}
        .card .h{font-size:15px;font-weight:700;line-height:1.3}
        .card .p{
          font-size:13px;color:var(--ink-soft);margin-top:4px;line-height:1.45;
          display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
        }
        .card .tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
        .card .tags span{
          font-size:11px;font-weight:600;background:var(--sage);color:var(--ink-soft);
          padding:3px 8px;border-radius:99px;
        }
        .card svg{width:16px;height:16px;flex:none;color:var(--ink-faint);margin-top:3px}

        .add{
          display:flex;align-items:center;justify-content:center;gap:8px;width:100%;
          border:1.5px dashed var(--line);background:none;border-radius:18px;padding:14px;
          font-size:14px;font-weight:600;color:var(--ink-soft);cursor:pointer;
          font-family:inherit;margin-top:4px;
        }
        .add svg{width:17px;height:17px}

        .stays{margin-top:24px}
        .stays h4{
          margin:0 0 9px;font-size:11.5px;font-weight:700;letter-spacing:.05em;
          text-transform:uppercase;color:var(--ink-faint);
        }
        .stayrow{
          display:flex;align-items:center;gap:12px;background:var(--surface);
          border-radius:16px;padding:12px 14px;margin-bottom:8px;box-shadow:var(--sh-s);
        }
        .stayrow span{flex:1;font-size:14px;font-weight:600}
        .stayrow button{
          border:0;background:var(--deep);color:#EAF2EC;border-radius:99px;
          padding:8px 15px;font-size:13px;font-weight:600;cursor:pointer;
          font-family:inherit;
        }
      `}</style>
    </div>
  );
}
