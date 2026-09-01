import { useState } from 'react';
import { blankItem } from '../lib/edits.js';
import PhotoPick from './PhotoPick.js';

// Changing the itinerary.
//
// raffy, 2026-09-01: "the whole editing manually also a concern to me .
// doesn't feel seamless. not streamline. not intuitive."
//
// He is describing the gap between the two halves of the app. You spend the
// whole build talking to someone who knows the trip — "make it later", "swap
// this for somewhere quieter" — and then to change one line you are handed a
// form with five fields and asked to write the prose yourself. The app stops
// being an agent and becomes a CMS.
//
// So the first thing a tap offers is the sentence, not the form. Saying what
// you want goes to the agent through edit_itinerary, which is instant and
// costs a chat turn rather than a rebuild. The form is still here, one tap
// down, for the times you know exactly what you want the words to say.
//
// Direct manipulation is kept only where it genuinely beats a sentence:
// swapping a photo, confirming a stay, removing something outright. Those are
// local operations — no API call, no cost, no waiting.

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


// The primary gesture. What you would have typed in the chat anyway, except it
// already knows which item you meant.
function Ask({ title, sub, chips, placeholder, verb, build, onAsk, onCancel, extra }) {
  const [text, setText] = useState('');
  const go = () => {
    const m = text.trim();
    if (m) onAsk(build(m));
  };
  return (
    <div className="ask">
      <div className="who">
        <b>{title}</b>
        {sub && <span>{sub}</span>}
      </div>

      <textarea
        rows={2}
        value={text}
        autoFocus
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); }
        }}
      />

      {/* A chip fills the box, it does not send. Tapping one and then adding
          "but keep it before dinner" is the normal case, and a chip that fires
          immediately makes that impossible. */}
      <div className="chips">
        {chips.map((c) => (
          <button key={c} className="chip" onClick={() => setText(c)}>{c}</button>
        ))}
      </div>

      <div className="row">
        <button className="go" disabled={!text.trim()} onClick={go}>{verb}</button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>

      {extra}

      <style jsx>{`
        .ask{
          background:var(--surface);border-radius:20px;padding:16px 17px 14px;
          box-shadow:var(--sh-m);margin:9px 0;
        }
        .who{display:flex;align-items:baseline;gap:9px;margin-bottom:11px}
        .who b{
          font-family:'Outfit',sans-serif;font-size:16px;font-weight:700;
          line-height:1.25;flex:1;min-width:0;
        }
        .who span{
          flex:none;font-size:11.5px;font-weight:700;color:var(--coral-text,#AE4715);
          background:var(--sage);padding:4px 9px;border-radius:99px;
        }
        textarea{
          width:100%;border:0;background:var(--sage);border-radius:14px;
          padding:12px 13px;font-size:15px;font-family:inherit;color:var(--ink);
          outline:0;resize:none;line-height:1.5;
        }
        textarea:focus{box-shadow:0 0 0 2px var(--coral)}
        .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
        .chip{
          border:0;background:var(--sage);color:var(--ink-soft);border-radius:99px;
          padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer;
          font-family:inherit;
        }
        .chip:active{opacity:.6}
        .row{display:flex;gap:8px;margin-top:13px}
        .go{
          flex:1;border:0;background:var(--deep);color:#EAF2EC;border-radius:99px;
          padding:11px;font-size:14.5px;font-weight:650;cursor:pointer;font-family:inherit;
        }
        .go:disabled{opacity:.4;cursor:default}
        .ghost{
          border:0;background:var(--sage);color:var(--ink-soft);border-radius:99px;
          padding:11px 16px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;
        }
      `}</style>
    </div>
  );
}

// The way down to the form, and to the one direct action worth keeping on an
// item. Deliberately quiet: this is the exit, not the road.
function AskFoot({ onManual, onDelete }) {
  return (
    <div className="foot">
      <button onClick={onManual}>Edit the details myself</button>
      {onDelete && <button className="del" onClick={onDelete}>Remove it</button>}
      <style jsx>{`
        .foot{
          display:flex;align-items:center;justify-content:space-between;gap:10px;
          margin-top:13px;padding-top:12px;border-top:1px solid var(--line);
        }
        .foot button{
          border:0;background:none;padding:0;font-family:inherit;font-size:12.5px;
          font-weight:650;color:var(--ink-faint);cursor:pointer;
        }
        .foot .del{color:var(--coral-text,#AE4715)}
      `}</style>
    </div>
  );
}

// `photosOnly` is the whole component now in practice: changing anything else
// is a button on the item itself, which asks the agent. What is left here is
// the one job direct manipulation genuinely wins — the agent cannot see a
// photograph, and picking one is faster than describing it.
export default function Editor({ itinerary, onOp, onAsk, photosOnly }) {
  const photos = itinerary.photos || {};
  const srcOf = (o) => (o && o.photo ? photos[o.photo] : '') || '';
  const [day, setDay] = useState(0);
  const [editing, setEditing] = useState(null);   // item index, or 'new'
  // 'ask' is the default for both: say what you want. 'form' is the way down
  // to the fields, and only ever reached deliberately.
  const [mode, setMode] = useState('ask');

  const days = itinerary.days || [];
  const d = days[day];
  if (!d) return null;
  const items = d.items || [];

  const close = () => { setEditing(null); setMode('ask'); };
  const open = (i) => { setEditing(i); setMode('ask'); };

  // "on Thu 10" — enough for the agent to find the day without an id, and it
  // reads like something a person would say. The day strip shouts THU because
  // it is a chip; a sentence should not.
  const cap = (x) => String(x || '').charAt(0).toUpperCase() + String(x || '').slice(1).toLowerCase();
  const when = d.dow && d.dom ? cap(d.dow) + ' ' + d.dom : ('day ' + (day + 1));
  const ask = (text) => { close(); if (onAsk) onAsk(text); };

  if (photosOnly) {
    return (
      <div className="editor">
        <div className="head">
          <h3>Photos</h3>
          <p>Swap any picture for one of your own.</p>
        </div>

        <div className="picrow">
          <div className="picname">Front page</div>
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

        <style jsx>{`
          .editor{padding-bottom:26px}
          .head{margin:4px 0 16px}
          .head h3{margin:0;font-family:'Outfit',sans-serif;font-size:23px;font-weight:700}
          .head p{margin:5px 0 0;font-size:13.5px;color:var(--ink-faint)}
          .picrow{
            background:var(--surface);border-radius:16px;padding:12px 13px;
            box-shadow:var(--sh-s);margin-bottom:8px;
          }
          .picname{font-size:13.5px;font-weight:650}
        `}</style>
      </div>
    );
  }

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
        editing === i && mode === 'ask' && onAsk ? (
          <Ask
            key={i}
            title={it.h}
            sub={it.t || 'no time'}
            placeholder="Make it later. Somewhere quieter. Book it for four."
            verb="Ask"
            chips={['Later in the day', 'Earlier', 'Somewhere quieter', 'Somewhere else nearby', 'Make it shorter']}
            build={(m) => 'Change "' + it.h + '" on ' + when + ': ' + m}
            onAsk={ask}
            onCancel={close}
            extra={
              <AskFoot
                onManual={() => setMode('form')}
                onDelete={() => { onOp({ type: 'item.delete', day, id: it._id, was: it.h }); close(); }}
              />
            }
          />
        ) : editing === i ? (
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
          <button key={i} className="card" onClick={() => open(i)}>
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
              {onAsk
                ? <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-7a8 8 0 0 1 8-8h2a8 8 0 0 1 8 4z" />
                : <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />}
            </svg>
          </button>
        )
      ))}

      {editing === 'new' && mode === 'ask' && onAsk ? (
        <Ask
          title={'Add to ' + when}
          placeholder="Somewhere for lunch near the hotel. A backup if it rains."
          verb="Ask"
          chips={['Somewhere to eat nearby', 'Something for the evening', 'A backup if it rains', 'Something the kids will like', 'A quiet hour']}
          build={(m) => 'Add to ' + when + ': ' + m}
          onAsk={ask}
          onCancel={close}
          extra={<AskFoot onManual={() => setMode('form')} />}
        />
      ) : editing === 'new' ? (
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
        <button className="add" onClick={() => open('new')}>
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
