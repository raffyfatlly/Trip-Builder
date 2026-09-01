import { useEffect, useMemo, useRef, useState } from 'react';
import { STEPS, seedMessage } from '../lib/onboarding.js';
import { ageNow } from '../lib/memory.js';

// The few taps before the conversation starts.
//
// Every step is skippable and the whole thing is skippable, because the agent
// asks better questions than a form does. This is here to save typing and to
// give the first reply something to work with — not to gate anything.

const blank = {
  destination: '', when: { start: '', end: '', rough: '' },
  who: { list: [{ name: '', age: '' }] }, about: [],
  // `asked` separates "nothing booked" from "never answered" — the first is an
  // answer worth putting in the opening message, the second is not.
  ready: { have: [], pace: '', asked: false },
};

export default function Onboard({ onStart, onSkip, memory }) {
  const [i, setI] = useState(0);
  const [a, setA] = useState(blank);

  // Who they travelled with last time.
  //
  // raffy, 2026-09-01: "if profile have been saved can give the option from the
  // saved info for easy click so no need to fill if same info."
  //
  // The profile already knows this and the ages move on their own, so typing
  // the same four names again is work the app is asking for and not using. It
  // is the same point memory.js opens with: the second trip should not start by
  // asking who is coming, it should start by asking whether it is the same four
  // of you. Everyone is on by default — the common case is one tap to nothing.
  const saved = useMemo(() => (memory && memory.people ? memory.people : []).map((p) => {
    const yrs = ageNow(p);
    return { name: p.name, age: yrs == null ? '' : String(yrs), saved: true };
  }).filter((p) => p.name), [memory]);

  // Seeded once, and only while they have not touched the step — memory can
  // arrive after this mounts, and re-seeding would undo their taps.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !saved.length) return;
    seeded.current = true;
    setA((p) => {
      const list = p.who.list || [];
      const blankOnly = list.length <= 1 && !(list[0] || {}).name && !(list[0] || {}).age;
      return blankOnly ? { ...p, who: { ...p.who, list: saved.map((x) => ({ ...x })) } } : p;
    });
  }, [saved]);

  const isOn = (name) => (a.who.list || []).some((p) => p.saved && p.name === name);
  const toggle = (person) => set('who', {
    ...a.who,
    list: isOn(person.name)
      ? a.who.list.filter((p) => !(p.saved && p.name === person.name))
      : [...a.who.list, { ...person }],
  });
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const set = (k, v) => setA((p) => ({ ...p, [k]: v }));
  const next = () => (last ? onStart(seedMessage(a), a) : setI(i + 1));

  // Enough to be worth answering. An empty step is a skip, not an error.
  const answered = {
    destination: !!a.destination.trim(),
    when: !!(a.when.start || a.when.rough),
    who: (a.who.list || []).some((p) => p.name.trim() || p.age),
    ready: !!(a.ready.pace || a.ready.have.length || a.ready.asked),
    about: a.about.length > 0,
  }[step.key];

  return (
    <div className="ob">
      <div className="obtop">
        <div className="pips">
          {STEPS.map((s, n) => <i key={s.key} className={n <= i ? 'on' : ''} />)}
        </div>
        <button className="skipall" onClick={() => onSkip()}>Skip</button>
      </div>

      <div className="obbody" key={step.key}>
        <h1>{step.title}</h1>
        <p className="obsub">
          {step.key === 'who' && saved.length
            ? 'Same as last time? Everyone is already in — take off anyone who is not coming.'
            : step.sub}
        </p>

        {step.type === 'text' && (
          <>
            <input
              className="obinput"
              autoFocus
              value={a.destination}
              placeholder={step.placeholder}
              onChange={(e) => set('destination', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && answered) next(); }}
            />
            <div className="chiprow">
              {step.chips.map((c) => (
                <button
                  key={c}
                  className={'obchip' + (a.destination === c ? ' on' : '')}
                  onClick={() => set('destination', c)}
                >{c}</button>
              ))}
            </div>
          </>
        )}

        {step.type === 'dates' && (
          <div className="fields">
            <label>
              <span>Arriving</span>
              <input type="date" value={a.when.start}
                onChange={(e) => set('when', { ...a.when, start: e.target.value })} />
            </label>
            <label>
              <span>Leaving</span>
              <input type="date" value={a.when.end} min={a.when.start || undefined}
                onChange={(e) => set('when', { ...a.when, end: e.target.value })} />
            </label>
            <label className="wide">
              <span>Or just roughly</span>
              <input placeholder="September, school holidays, next spring"
                value={a.when.rough}
                onChange={(e) => set('when', { ...a.when, rough: e.target.value })} />
            </label>
          </div>
        )}

        {step.type === 'who' && (
          <div className="who">
            {saved.length > 0 && (
              <div className="saved">
                <span className="savedlab">From your profile</span>
                <div className="chiprow wrap">
                  {saved.map((p) => (
                    <button
                      key={p.name}
                      className={'obchip person' + (isOn(p.name) ? ' on' : '')}
                      onClick={() => toggle(p)}
                    >
                      {p.name}{p.age ? <em>{p.age}</em> : null}
                    </button>
                  ))}
                </div>
                <p className="tiny">Tap anyone who isn't coming this time. Ages are counted forward, so correct one if it's off.</p>
              </div>
            )}

            {(a.who.list || []).map((p, n) => p.saved ? null : (
              <div className="whorow" key={n}>
                <input
                  placeholder={n === 0 ? 'Your name' : 'Name'}
                  value={p.name}
                  onChange={(e) => {
                    const list = [...a.who.list];
                    list[n] = { ...list[n], name: e.target.value };
                    set('who', { ...a.who, list });
                  }}
                />
                <input
                  className="age"
                  placeholder="Age"
                  inputMode="numeric"
                  value={p.age}
                  onChange={(e) => {
                    const list = [...a.who.list];
                    list[n] = { ...list[n], age: e.target.value.replace(/\D/g, '').slice(0, 2) };
                    set('who', { ...a.who, list });
                  }}
                />
                {a.who.list.length > 1 && (
                  <button className="whox" aria-label="Remove"
                    onClick={() => set('who', { ...a.who, list: a.who.list.filter((_, j) => j !== n) })}>×</button>
                )}
              </div>
            ))}
            <button className="addwho"
              onClick={() => set('who', { ...a.who, list: [...a.who.list, { name: '', age: '' }] })}>
              + Add someone
            </button>
            {(a.who.list || []).some((p) => !p.saved) && (
              <p className="tiny">Leave the age blank for adults.</p>
            )}
          </div>
        )}

        {step.type === 'ready' && (
          <div className="ready">
            <div className="chiprow wrap">
              <button
                className={'obchip' + (a.ready.asked && !a.ready.have.length ? ' on' : '')}
                onClick={() => set('ready', { ...a.ready, have: [], asked: true })}
              >Nothing yet</button>
              {step.options.map((o) => (
                <button
                  key={o}
                  className={'obchip' + (a.ready.have.includes(o) ? ' on' : '')}
                  onClick={() => set('ready', {
                    ...a.ready, asked: true,
                    have: a.ready.have.includes(o)
                      ? a.ready.have.filter((x) => x !== o)
                      : [...a.ready.have, o],
                  })}
                >{o}</button>
              ))}
            </div>

            <span className="rlab">How full do you like your days?</span>
            <div className="paces">
              {step.paces.map((p) => (
                <button
                  key={p.key}
                  className={'pace' + (a.ready.pace === p.key ? ' on' : '')}
                  onClick={() => set('ready', { ...a.ready, pace: p.key, asked: true })}
                >
                  <b>{p.label}</b>
                  <em>{p.hint}</em>
                </button>
              ))}
            </div>
          </div>
        )}

        {step.type === 'multi' && (
          <div className="chiprow wrap">
            {step.options.map((o) => (
              <button
                key={o}
                className={'obchip' + (a.about.includes(o) ? ' on' : '')}
                onClick={() => set('about', a.about.includes(o)
                  ? a.about.filter((x) => x !== o)
                  : [...a.about, o])}
              >{o}</button>
            ))}
          </div>
        )}
      </div>

      <div className="obfoot">
        {i > 0 && <button className="obback" onClick={() => setI(i - 1)}>Back</button>}
        <button className="obnext" onClick={next}>
          {last ? 'Start planning' : (answered ? 'Next' : 'Skip this')}
        </button>
      </div>

      <style jsx>{`
        .ob{
          flex:1;display:flex;flex-direction:column;min-height:0;
          padding:0 2px calc(18px + env(safe-area-inset-bottom));
        }
        .obtop{display:flex;align-items:center;justify-content:space-between;padding:2px 0 22px}
        .pips{display:flex;gap:6px}
        .pips i{width:22px;height:4px;border-radius:99px;background:var(--line);transition:background 240ms var(--e)}
        .pips i.on{background:var(--deep)}
        .skipall{
          border:0;background:none;color:var(--ink-soft);font-size:13px;font-weight:600;
          cursor:pointer;padding:4px 2px;
        }
        .skipall:hover{color:var(--ink)}

        /* overflow-y:auto also clips horizontally, which was shaving the focus
           ring off both edges of the inputs. The padding gives the ring room
           inside the scroll box; the negative margin keeps the text aligned
           with everything else. */
        .obbody{
          flex:1;min-height:0;overflow-y:auto;animation:rise 280ms var(--e) both;
          padding:0 4px;margin:0 -4px;
        }
        h1{
          font-family:'Outfit',sans-serif;font-size:31px;line-height:1.1;font-weight:800;
          letter-spacing:-.01em;margin:0 0 8px;
        }
        .obsub{margin:0 0 22px;color:var(--ink-soft);font-size:14px;line-height:1.5;max-width:34ch}

        .obinput{
          width:100%;border:0;background:var(--surface);border-radius:16px;
          padding:15px 16px;font-size:16px;font-family:inherit;color:var(--ink);
          box-shadow:var(--sh-s);outline:none;
        }
        .obinput:focus{box-shadow:0 0 0 2px var(--deep)}

        /* Wrapped, not scrolled. A row that runs off the edge looks broken
           rather than scrollable, and there is plenty of room down the page. */
        .chiprow{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
        .chiprow.wrap{margin-top:0}
        .obchip{
          flex:0 0 auto;max-width:100%;border:0;background:var(--surface);color:var(--ink-soft);
          padding:10px 14px;border-radius:99px;font-size:13.5px;font-weight:600;
          cursor:pointer;box-shadow:var(--sh-s);white-space:nowrap;
          transition:transform 150ms var(--e);
        }
        .obchip:active{transform:scale(.96)}
        .obchip.on{background:var(--deep);color:#EAF2EC}

        .ready{display:flex;flex-direction:column;gap:0}
        .rlab{
          display:block;margin:26px 0 10px;font-size:11px;font-weight:750;
          letter-spacing:.07em;text-transform:uppercase;color:var(--ink-faint);
        }
        /* Three whole cards rather than three chips: pace is the one answer
           here that changes every day of the trip, and it earns the room. */
        .paces{display:flex;gap:8px}
        .pace{
          flex:1;border:0;background:var(--surface);box-shadow:var(--sh-s);
          border-radius:16px;padding:13px 11px;text-align:left;cursor:pointer;
          font-family:inherit;color:var(--ink);transition:transform 150ms var(--e);
          display:flex;flex-direction:column;gap:4px;min-width:0;
        }
        .pace:active{transform:scale(.96)}
        .pace b{font-size:14.5px;font-weight:700;line-height:1.15}
        .pace em{font-style:normal;font-size:11.5px;line-height:1.35;color:var(--ink-faint)}
        .pace.on{background:var(--deep);color:#EAF2EC}
        .pace.on em{color:#B9CFC2}

        /* A saved person is a chip with their age on it, so the whole step can
           be read at a glance and answered without the keyboard opening. */
        .saved{margin-bottom:18px}
        .savedlab{
          display:block;font-size:11px;font-weight:750;letter-spacing:.07em;
          text-transform:uppercase;color:var(--ink-faint);margin-bottom:9px;
        }
        .obchip.person{display:inline-flex;align-items:center;gap:7px;padding:9px 13px}
        .obchip.person em{
          font-style:normal;font-size:11.5px;font-weight:750;line-height:1;
          background:var(--sage);color:var(--deep);padding:4px 7px;border-radius:99px;
        }
        .obchip.person.on em{background:rgba(255,255,255,.17);color:#EAF2EC}
        /* Off reads as taken off, not as never offered. */
        .obchip.person:not(.on){opacity:.5;box-shadow:none;background:transparent;
          outline:1.5px dashed var(--line);outline-offset:-1.5px}
        .saved .tiny{margin-top:10px}

        .fields{display:flex;flex-wrap:wrap;gap:12px}
        .fields label{flex:1 1 140px;display:flex;flex-direction:column;gap:7px}
        .fields label.wide{flex:1 1 100%}
        .fields span{font-size:12.5px;font-weight:650;color:var(--ink-soft)}
        .fields input{
          border:0;background:var(--surface);border-radius:14px;padding:13px 14px;
          font-size:15px;font-family:inherit;color:var(--ink);box-shadow:var(--sh-s);
          outline:none;width:100%;
        }
        .fields input:focus{box-shadow:0 0 0 2px var(--deep)}

        .who{display:flex;flex-direction:column;gap:9px;align-items:flex-start}
        .whorow{display:flex;gap:8px;width:100%;align-items:center}
        .whorow input{
          flex:1;min-width:0;border:0;background:var(--surface);border-radius:14px;
          padding:13px 14px;font-size:15px;font-family:inherit;color:var(--ink);
          box-shadow:var(--sh-s);outline:none;
        }
        .whorow input:focus{box-shadow:0 0 0 2px var(--deep)}
        .whorow .age{flex:none;width:74px}
        .whox{
          flex:none;border:0;background:none;color:var(--ink-soft);font-size:19px;
          line-height:1;padding:6px 8px;border-radius:9px;cursor:pointer;opacity:.5;
        }
        .whox:hover{opacity:1;background:var(--sage)}
        .addwho{
          border:0;background:var(--sage);color:var(--ink-soft);font-size:13px;font-weight:650;
          padding:9px 14px;border-radius:99px;cursor:pointer;margin-top:2px;
        }
        .tiny{margin:4px 0 0;font-size:12px;color:var(--ink-faint)}

        .obfoot{display:flex;gap:10px;align-items:center;padding-top:16px;flex:none}
        .obback{
          border:0;background:var(--surface);color:var(--ink-soft);font-size:14px;font-weight:600;
          padding:14px 20px;border-radius:99px;box-shadow:var(--sh-s);cursor:pointer;
        }
        .obnext{
          flex:1;border:0;background:var(--deep);color:#EAF2EC;font-size:15px;font-weight:650;
          padding:15px 22px;border-radius:99px;box-shadow:var(--sh-m);cursor:pointer;
          transition:transform 160ms var(--e);
        }
        .obnext:active{transform:scale(.985)}
      `}</style>
    </div>
  );
}
