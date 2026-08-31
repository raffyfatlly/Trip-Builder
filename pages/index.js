import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { renderPreview, downloadName } from '../lib/preview.js';
import { applyEdits, countStale, loadEdits, saveEdits, forRender } from '../lib/edits.js';
import { loadTrips, rememberTrip, forgetTrip, shortDate } from '../lib/trips.js';
import Editor from '../components/Editor.js';
import Block from '../components/Blocks.js';
import Onboard from '../components/Onboard.js';
import Plan from '../components/Plan.js';

const KEY = 'itin.session.v1';
const POLL_MS = 2000;

export default function Home() {
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState([]);      // uploaded, not yet sent
  const [thinking, setThinking] = useState(false);
  const [building, setBuilding] = useState(false);
  const [itinerary, setItinerary] = useState(null);
  const [preview, setPreview] = useState('');
  const [sheet, setSheet] = useState(false);       // itinerary open on mobile
  const [error, setError] = useState('');
  const [booting, setBooting] = useState(true);
  const [edits, setEdits] = useState([]);
  const [pane, setPane] = useState('preview');   // preview | edit
  const [staleNote, setStaleNote] = useState(0);
  const [agentEdits, setAgentEdits] = useState([]);
  const [trips, setTrips] = useState([]);
  const [tripsOpen, setTripsOpen] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const [plan, setPlan] = useState({});
  const [skipOb, setSkipOb] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const router = useRouter();

  const scroller = useRef(null);
  const inputRef = useRef(null);
  const lastItinerary = useRef('');

  // --- session ------------------------------------------------------------
  useEffect(() => {
    setTrips(loadTrips());

    // ?s=<session id> opens one specific trip. It is how a trip gets back to
    // you when the browser has lost it — a different phone, cleared storage.
    let id = null;
    let q = null;
    try { q = new URLSearchParams(location.search).get('s'); } catch (e) { /* ignore */ }
    if (q) {
      id = q;
      try { localStorage.setItem(KEY, q); } catch (e) { /* private mode */ }
      // Through the router, not history.replaceState: Next rewrites the URL
      // from its own history state during hydration, so a raw replaceState is
      // undone a moment later and ?s= stays put — which would make "New trip"
      // reopen the same trip forever.
      router.replace('/', undefined, { shallow: true });
    }

    if (!id) {
      try { id = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    }
    if (id) { setSession(id); setBooting(false); return; }

    fetch('/api/session', { method: 'POST' })
      .then((d0) => d0.json())
      .then((d) => {
        if (!d.session) throw new Error(d.error || 'no session');
        try { localStorage.setItem(KEY, d.session); } catch (e) { /* ignore */ }
        setSession(d.session);
      })
      .catch(() => setError('Could not start. Reload to try again.'))
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (session) setEdits(loadEdits(session));
  }, [session]);

  // Keep this browser's trip list current. The label is the destination once
  // the itinerary exists, and before that the first thing they typed — an
  // unbuilt trip is still worth being able to get back to.
  const lastLabel = useRef('');
  useEffect(() => {
    if (!session || !messages.length) return;
    const t = itinerary && itinerary.trip && itinerary.trip.title;
    const first = messages.find((m) => m.role === 'user');
    const label = t || (first ? first.text.replace(/\s+/g, ' ').slice(0, 42) : '');
    if (!label || label === lastLabel.current) return;
    lastLabel.current = label;
    rememberTrip(session, label);
    setTrips(loadTrips());
  }, [session, itinerary, messages]);

  // --- polling ------------------------------------------------------------
  useEffect(() => {
    if (!session) return;
    let alive = true;
    let timer;

    const tick = async () => {
      try {
        const r = await fetch('/api/state?session=' + encodeURIComponent(session));
        const d = await r.json();
        if (!alive) return;
        if (d.transcript) setMessages(d.transcript);
        setThinking(!!d.thinking);
        setBuilding(!!d.building);
        if (d.itinerary) setItinerary(d.itinerary);
        setAgentEdits(d.agentEdits || []);
        setPlan(d.plan || {});
        setLoaded(true);
      } catch (e) { /* transient, next tick retries */ }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [session]);

  // The itinerary is read-only (replayed from the event log), so manual edits
  // live alongside it and are applied on top.
  // Two sources of edits: the chat agent's (replayed from the chat log) and
  // the traveller's own (localStorage). Ordered by timestamp so whichever
  // happened last wins, rather than one source always overriding the other.
  const allEdits = useMemo(() => {
    const merged = [...agentEdits, ...edits];
    merged.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return merged;
  }, [agentEdits, edits]);

  const working = useMemo(
    () => applyEdits(itinerary, allEdits), [itinerary, allEdits]);

  // A rebuild can orphan edits that pointed at days which no longer exist.
  // Say so rather than letting them disappear quietly.
  useEffect(() => {
    if (!itinerary || !allEdits.length) return;
    setStaleNote(countStale(itinerary, allEdits));
  }, [itinerary, allEdits]);

  const applyOp = useCallback((op) => {
    setEdits((prev) => {
      const next = [...prev, { ...op, ts: Date.now(), by: 'you' }];
      if (session) saveEdits(session, next);
      return next;
    });
  }, [session]);

  const undoEdits = useCallback(() => {
    setEdits([]);
    if (session) saveEdits(session, []);
    setStaleNote(0);
  }, [session]);

  // --- render the preview when the itinerary actually changes -------------
  useEffect(() => {
    if (!working || !working.days || !working.days.length) return;
    const sig = JSON.stringify(working);
    if (sig === lastItinerary.current) return;
    lastItinerary.current = sig;
    renderPreview(forRender(working))
      .then(setPreview)
      .catch((e) => console.error('preview failed', e));
  }, [working]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking, building]);

  // --- sending ------------------------------------------------------------
  const send = useCallback(async (override) => {
    const text = typeof override === 'string' ? override : draft.trim();
    if ((!text && !pending.length) || !session) return;

    // Optimistic: the poll will replace this with the real transcript.
    const label = [pending.map((f) => '📎 ' + f.name).join('\n'), text]
      .filter(Boolean).join('\n');
    setMessages((m) => [...m, { role: 'user', text: label, id: 'tmp' + Date.now() }]);
    if (typeof override !== 'string') setDraft('');
    const files = pending;
    setPending([]);
    setThinking(true);

    try {
      const r = await fetch('/api/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session, text, files,
          // The browser knows its own timezone exactly; the IP lookup only
          // approximates it. No permission prompt for either.
          client: {
            tz: (() => {
              try { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
              catch (e) { return null; }
            })(),
            lang: typeof navigator !== 'undefined' ? navigator.language : null,
          },
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || 'Could not send that.');
        setThinking(false);
      }
    } catch (e) {
      setError('Could not send that.');
      setThinking(false);
    }
  }, [draft, pending, session]);

  const attach = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const f of files) {
      try {
        const data = await new Promise((ok, no) => {
          const rd = new FileReader();
          rd.onload = () => ok(String(rd.result).split(',')[1]);
          rd.onerror = no;
          rd.readAsDataURL(f);
        });
        const r = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: f.name, type: f.type, data }),
        });
        const d = await r.json();
        if (d.file_id) setPending((p) => [...p, d]);
        else setError(d.error || 'Could not attach that.');
      } catch (err) {
        setError('Could not attach that.');
      }
    }
  };

  const download = () => {
    const blob = new Blob([preview], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName(working);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Starting a new trip must never lose the last one. The id stays in the
  // trip list; only the pointer to the current one is cleared.
  const startOver = () => {
    setTripsOpen(false);
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    location.reload();
  };

  // Switching trips reloads rather than swapping state in place: everything on
  // this page hangs off the session id, and a reload is the one way to be sure
  // none of the old trip is left behind.
  const openTrip = (id) => {
    if (id === session) { setTripsOpen(false); return; }
    try { localStorage.setItem(KEY, id); } catch (e) { /* ignore */ }
    location.reload();
  };

  const dropTrip = (id) => {
    forgetTrip(id);
    setTrips(loadTrips());
  };

  // The builder can land save_itinerary before it has written any days, so an
  // itinerary object alone is not enough to show. Wait for a real day.
  const ready = !!(working && working.days && working.days.length > 0);
  const title = working && working.trip ? working.trip.title : null;

  // A build runs for minutes, so it almost always lands while they are still
  // typing. Mark the button rather than interrupting them.
  //
  // Must sit below `ready`: the dependency array is evaluated during render,
  // so referencing it from higher up hits the temporal dead zone and takes the
  // whole page down.
  const wasBuilding = useRef(false);
  useEffect(() => {
    if (wasBuilding.current && !building && ready) setUnseen(true);
    wasBuilding.current = building;
  }, [building, ready]);

  const openSheet = () => { setSheet(true); setUnseen(false); };

  // The onboarding steps stand in for the empty chat, not in front of it: skip
  // them and you are simply in the conversation with the box focused.
  //
  // Waits for the first poll. Reopening an existing trip starts with an empty
  // transcript for a moment, and flashing the onboarding at someone who is
  // three days into planning would be its own small betrayal.
  const onboarding = !booting && loaded && messages.length === 0 && !skipOb;

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">
          <span className="dot" />
          <span>Trip builder</span>
        </div>
        <div className="baractions">
          {ready && (
            <button className="itbtn" onClick={openSheet}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
              </svg>
              Itinerary
              {unseen && <i className="ping" />}
            </button>
          )}
          {/* The menu holds this browser's trips and the way to start another.
              On a first visit there is neither, so there is nothing to open. */}
          {trips.length > 0 && (
          <div className="trips">
            <button
              className="ghostbtn"
              onClick={() => setTripsOpen((v) => !v)}
              aria-expanded={tripsOpen}
            >
              My trips
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {tripsOpen && (
              <>
                <div className="scrim" onClick={() => setTripsOpen(false)} />
                <div className="menu">
                  {trips.map((t) => (
                    <div key={t.id} className={'trip' + (t.id === session ? ' on' : '')}>
                      <button className="pick" onClick={() => openTrip(t.id)}>
                        <span className="lbl">{t.label}</span>
                        <span className="when">{t.id === session ? 'open now' : shortDate(t.at)}</span>
                      </button>
                      {t.id !== session && (
                        <button className="x" title="Remove from this list" onClick={() => dropTrip(t.id)}>×</button>
                      )}
                    </div>
                  ))}
                  {trips.length > 0 && <div className="rule" />}
                  <button className="startnew" onClick={startOver}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    New trip
                  </button>
                </div>
              </>
            )}
          </div>
          )}
        </div>
      </header>

      <main className="split">
        <section className={'chat' + (sheet ? ' hidden-m' : '')}>
          {onboarding ? (
            <Onboard
              onStart={(seed) => { setSkipOb(true); send(seed); }}
              onSkip={() => { setSkipOb(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            />
          ) : (
            <>
          <Plan
            plan={plan}
            built={ready}
            building={building}
            onBuild={() => send('Build it now with what you have.')}
          />
          <div className="scroll" ref={scroller}>
            {booting && <div className="sys">Starting…</div>}

            {!booting && messages.length === 0 && skipOb && (
              <div className="intro">
                <h1>Where are you going?</h1>
                <p>
                  Tell me about your trip and I will plan it with you, then build
                  you an itinerary app for it.
                </p>
                <div className="egs">
                  {[
                    'Da Nang with my wife and 2 kids, 10 to 14 September, staying at Furama',
                    'Tokyo for a week in November, first time, just the two of us',
                  ].map((s) => (
                    <button key={s} className="eg" onClick={() => { setDraft(s); inputRef.current?.focus(); }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => (
              m.role === 'block' ? (
                <Block key={m.id} block={m} disabled={thinking} onChoose={(t) => send(t)} />
              ) : (
                <div key={m.id} className={'msg ' + m.role}>
                  {m.text.split('\n').map((line, i) => <p key={i}>{line}</p>)}
                </div>
              )
            ))}

            {thinking && (
              <div className="msg assistant typing">
                <span /><span /><span />
              </div>
            )}
            {building && (
              <div className="working">
                <span className="spin" />
                Researching and building your itinerary. This takes a couple of minutes.
              </div>
            )}
          </div>

          {error && (
            <div className="err" onClick={() => setError('')}>{error} <b>Dismiss</b></div>
          )}

          <div className="composer">
            {pending.length > 0 && (
              <div className="chips">
                {pending.map((f, i) => (
                  <span key={i} className="chip">
                    {f.name}
                    <button onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="row">
              <label className="attach" title="Attach a photo or booking">
                <input type="file" multiple accept="image/*,application/pdf,text/plain" onChange={attach} />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5" />
                </svg>
              </label>
              <textarea
                ref={inputRef}
                rows={1}
                value={draft}
                placeholder="Tell me about your trip"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                }}
              />
              <button className="sendbtn" onClick={send} disabled={!draft.trim() && !pending.length}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12h15M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </div>
            </>
          )}
        </section>

        <section className={'pane' + (sheet ? ' open' : '')}>
          <div className="panehead">
            <button className="back" onClick={() => setSheet(false)} aria-label="Back to chat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <span>{title || 'Your itinerary'}</span>
            {ready && <button className="dl" onClick={download}>Download</button>}
          </div>

          {ready && (
            <div className="seg">
              <button className={pane === 'preview' ? 'on' : ''}
                onClick={() => setPane('preview')}>Preview</button>
              <button className={pane === 'edit' ? 'on' : ''}
                onClick={() => setPane('edit')}>Edit</button>
              {allEdits.length > 0 && (
                <span className="count">{allEdits.length} edit{allEdits.length > 1 ? 's' : ''}</span>
              )}
            </div>
          )}

          {staleNote > 0 && (
            <div className="stale">
              {staleNote} of your edits no longer match the rebuilt itinerary and were skipped.
              <button onClick={undoEdits}>Clear edits</button>
            </div>
          )}

          {ready && pane === 'edit' ? (
            <div className="editwrap">
              <Editor itinerary={working} onOp={applyOp} />
            </div>
          ) : (
            <div className="phone">
              {preview
                ? <iframe title="Itinerary preview" srcDoc={preview} />
                : (
                  <div className="empty">
                    <div className="ph" />
                    <p>{building
                      ? 'Building your itinerary…'
                      : 'Your itinerary will appear here once there is enough to build.'}</p>
                  </div>
                )}
            </div>
          )}
        </section>
      </main>

      <style jsx global>{`
        :root{
          --bg:#EDF2EA; --surface:#FFFFFF; --sage:#E2EBDE; --deep:#10362A;
          --ink:#0C241B; --ink-soft:#4C6157; --ink-faint:#5A6C63;
          --coral:#EE7B45; --line:rgba(12,36,27,.10);
          --sh-s:0 2px 10px rgba(12,36,27,.06);
          --sh-m:0 8px 26px -10px rgba(12,36,27,.20);
          --sh-l:0 18px 44px -16px rgba(12,36,27,.30);
          --e:cubic-bezier(.23,1,.32,1);
        }
        *{box-sizing:border-box}
        html,body,#__next{height:100%}
        body{
          margin:0;background:var(--bg);color:var(--ink);
          font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          -webkit-font-smoothing:antialiased;
        }
        button{font-family:inherit}
      `}</style>

      <style jsx>{`
        .app{display:flex;flex-direction:column;height:100%}
        .bar{
          display:flex;align-items:center;justify-content:space-between;
          padding:calc(12px + env(safe-area-inset-top)) 18px 12px;
          flex:none;
        }
        .brand{display:flex;align-items:center;gap:9px;font-weight:700;font-size:15px}
        .dot{width:11px;height:11px;border-radius:99px;background:var(--coral);flex:none}
        .ghostbtn{
          border:0;background:var(--surface);color:var(--ink-soft);font-size:13px;font-weight:600;
          padding:8px 14px;border-radius:99px;box-shadow:var(--sh-s);cursor:pointer;
          transition:transform 160ms var(--e);
        }
        .ghostbtn:active{transform:scale(.96)}

        .baractions{display:flex;align-items:center;gap:8px}
        .ghostbtn svg{width:13px;height:13px;margin-left:5px;vertical-align:-2px}

        .trips{position:relative}
        .scrim{position:fixed;inset:0;z-index:40}
        .menu{
          position:absolute;top:calc(100% + 8px);right:0;z-index:41;
          width:min(80vw,268px);padding:6px;
          background:var(--surface);border-radius:16px;box-shadow:var(--sh-l);
          max-height:min(60vh,420px);overflow-y:auto;
        }
        .trip{display:flex;align-items:center}
        .pick{
          flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:2px;
          border:0;background:none;cursor:pointer;text-align:left;
          padding:9px 10px;border-radius:11px;color:inherit;
        }
        .pick:hover{background:var(--sage)}
        .trip.on .pick{background:var(--sage)}
        .lbl{
          font-size:13.5px;font-weight:650;line-height:1.25;
          max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        }
        .when{font-size:11px;color:var(--ink-soft);font-weight:600}
        .x{
          flex:none;border:0;background:none;color:var(--ink-soft);cursor:pointer;
          font-size:17px;line-height:1;padding:6px 9px;border-radius:9px;opacity:.5;
        }
        .x:hover{opacity:1;background:var(--sage)}
        .rule{height:1px;background:var(--line);margin:5px 8px}
        .startnew{
          display:flex;align-items:center;gap:8px;width:100%;
          border:0;background:none;cursor:pointer;color:var(--ink-soft);
          font-size:13px;font-weight:650;padding:9px 10px;border-radius:11px;
        }
        .startnew svg{width:14px;height:14px}
        .startnew:hover{background:var(--sage);color:var(--ink)}

        .split{flex:1;display:flex;min-height:0;gap:20px;padding:0 16px 0}

        .chat{flex:1;display:flex;flex-direction:column;min-height:0;min-width:0}
        .scroll{flex:1;overflow-y:auto;padding:6px 2px 10px;scroll-behavior:smooth}

        .intro{padding:26px 4px 10px;max-width:30ch}
        .intro h1{
          font-family:'Outfit',sans-serif;font-size:34px;line-height:1.08;
          font-weight:800;margin:0 0 12px;letter-spacing:-.01em;
        }
        .intro p{margin:0;color:var(--ink-soft);font-size:15px;line-height:1.55}
        .egs{display:flex;flex-direction:column;gap:9px;margin-top:22px}
        .eg{
          text-align:left;border:0;background:var(--surface);color:var(--ink-soft);
          padding:13px 16px;border-radius:18px;box-shadow:var(--sh-s);font-size:13.5px;
          line-height:1.45;cursor:pointer;transition:transform 160ms var(--e);
        }
        .eg:active{transform:scale(.98)}

        .msg{
          max-width:min(80%,52ch);padding:12px 16px;border-radius:22px;margin:9px 0;
          font-size:15px;line-height:1.55;animation:rise 260ms var(--e) both;
        }
        .msg p{margin:0}
        .msg p + p{margin-top:9px}
        .msg.assistant{background:var(--surface);box-shadow:var(--sh-s);border-bottom-left-radius:8px}
        .msg.user{
          background:var(--deep);color:#EAF2EC;margin-left:auto;
          border-bottom-right-radius:8px;box-shadow:var(--sh-m);
        }
        @keyframes rise{from{opacity:0;transform:translateY(7px) scale(.985)}to{opacity:1;transform:none}}

        .typing{display:flex;gap:5px;align-items:center;width:auto;max-width:none;width:fit-content}
        .typing span{
          width:7px;height:7px;border-radius:99px;background:var(--ink-faint);opacity:.45;
          animation:bob 1.15s infinite;
        }
        .typing span:nth-child(2){animation-delay:.14s}
        .typing span:nth-child(3){animation-delay:.28s}
        @keyframes bob{0%,60%,100%{transform:none;opacity:.35}30%{transform:translateY(-4px);opacity:.85}}

        .working{
          display:flex;align-items:center;gap:11px;margin:12px 0;padding:14px 17px;
          background:var(--sage);border-radius:20px;font-size:13.5px;color:var(--ink-soft);
          line-height:1.45;
        }
        .spin{
          width:15px;height:15px;flex:none;border-radius:99px;
          border:2px solid rgba(12,36,27,.15);border-top-color:var(--coral);
          animation:spin .8s linear infinite;
        }
        @keyframes spin{to{transform:rotate(360deg)}}

        .sys{color:var(--ink-faint);font-size:14px;padding:20px 4px}
        .err{
          background:#FBE6DC;color:#8C3B14;padding:11px 15px;border-radius:16px;
          font-size:13.5px;margin:0 0 10px;cursor:pointer;
        }

        .composer{flex:none;padding:8px 0 calc(12px + env(safe-area-inset-bottom))}
        .chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:9px}
        .chip{
          display:inline-flex;align-items:center;gap:7px;background:var(--sage);
          padding:7px 8px 7px 13px;border-radius:99px;font-size:12.5px;color:var(--ink-soft);
        }
        .chip button{border:0;background:none;font-size:16px;line-height:1;color:var(--ink-faint);cursor:pointer;padding:0 3px}
        .row{
          display:flex;align-items:flex-end;gap:8px;background:var(--surface);
          border-radius:26px;padding:7px 7px 7px 6px;box-shadow:var(--sh-m);
        }
        .attach{
          width:42px;height:42px;flex:none;display:grid;place-items:center;cursor:pointer;
          color:var(--ink-faint);border-radius:99px;transition:background 160ms;
        }
        .attach:hover{background:var(--sage)}
        .attach input{display:none}
        .attach svg{width:20px;height:20px}
        textarea{
          flex:1;border:0;outline:0;resize:none;background:none;font-size:16px;
          line-height:1.45;padding:11px 2px;max-height:140px;color:var(--ink);
          font-family:inherit;
        }
        textarea::placeholder{color:var(--ink-faint)}
        .sendbtn{
          width:42px;height:42px;flex:none;border:0;border-radius:99px;background:var(--coral);
          color:#fff;display:grid;place-items:center;cursor:pointer;
          transition:transform 160ms var(--e),opacity 160ms;
        }
        .sendbtn svg{width:20px;height:20px}
        .sendbtn:disabled{opacity:.32;cursor:default}
        .sendbtn:not(:disabled):active{transform:scale(.92)}

        .pane{flex:1;min-width:0;display:flex;flex-direction:column;padding-bottom:16px}
        .panehead{
          display:flex;align-items:center;gap:10px;padding:4px 2px 12px;
          font-weight:700;font-size:14.5px;flex:none;
        }
        .panehead span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .back{display:none;border:0;background:none;padding:6px;cursor:pointer;color:var(--ink)}
        .back svg{width:22px;height:22px;display:block}
        .dl{
          border:0;background:var(--deep);color:#EAF2EC;font-size:13px;font-weight:600;
          padding:9px 16px;border-radius:99px;cursor:pointer;flex:none;
          transition:transform 160ms var(--e);
        }
        .dl:active{transform:scale(.95)}
        .seg{
          display:flex;align-items:center;gap:6px;flex:none;
          background:var(--sage);border-radius:99px;padding:4px;margin-bottom:12px;
          align-self:flex-start;
        }
        .seg button{
          border:0;background:none;border-radius:99px;padding:8px 18px;
          font-size:13.5px;font-weight:600;color:var(--ink-soft);cursor:pointer;
          font-family:inherit;transition:background 160ms,color 160ms;
        }
        .seg button.on{background:var(--surface);color:var(--ink);box-shadow:var(--sh-s)}
        .seg .count{
          font-size:12px;color:var(--ink-faint);padding-right:12px;padding-left:2px;
        }
        .stale{
          display:flex;align-items:center;gap:10px;flex:none;
          background:#FBE6DC;color:#8C3B14;border-radius:16px;padding:11px 14px;
          font-size:13px;line-height:1.4;margin-bottom:12px;
        }
        .stale button{
          border:0;background:#8C3B14;color:#fff;border-radius:99px;
          padding:7px 13px;font-size:12.5px;font-weight:600;cursor:pointer;
          font-family:inherit;flex:none;
        }
        .editwrap{flex:1;min-height:0;overflow-y:auto;padding-right:2px}
        .phone{
          flex:1;min-height:0;border-radius:28px;overflow:hidden;background:var(--surface);
          box-shadow:var(--sh-l);
        }
        .phone iframe{width:100%;height:100%;border:0;display:block}
        .empty{
          height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;
          gap:16px;padding:32px;text-align:center;color:var(--ink-faint);
        }
        .empty p{margin:0;font-size:14px;line-height:1.5;max-width:26ch}
        .ph{
          width:52px;height:52px;border-radius:18px;
          background:linear-gradient(160deg,var(--sage),#D5E2D2);
        }

        /* The way through to the itinerary lives in the header. It used to
           float above the composer, where it sat on top of the last thing the
           agent said — the one part of the screen you are reading. */
        .itbtn{
          position:relative;display:inline-flex;align-items:center;gap:7px;
          border:0;background:var(--deep);color:#EAF2EC;
          padding:8px 14px;border-radius:99px;box-shadow:var(--sh-s);
          font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;
          transition:transform 160ms var(--e);
        }
        .itbtn:active{transform:scale(.96)}
        .itbtn svg{width:15px;height:15px;flex:none}
        .ping{
          position:absolute;top:-2px;right:-2px;width:9px;height:9px;border-radius:99px;
          background:var(--coral);border:2px solid var(--bg);
        }

        @media (max-width:860px){
          .split{padding:0 14px}
          .pane{
            position:fixed;inset:0;z-index:30;background:var(--bg);
            padding:calc(10px + env(safe-area-inset-top)) 14px calc(14px + env(safe-area-inset-bottom));
            transform:translateY(100%);transition:transform 320ms var(--e);
          }
          .pane.open{transform:none}
          .back{display:block}
          .hidden-m{display:none}
          .intro h1{font-size:30px}
        }
        @media (min-width:861px){
          .itbtn{display:none}
          .split{max-width:1180px;margin:0 auto;width:100%}
          .chat{max-width:560px}
          .phone{max-width:430px;margin:0 auto;width:100%}
        }
        @media (prefers-reduced-motion:reduce){
          *{animation-duration:1ms !important;transition-duration:1ms !important}
        }
      `}</style>
    </div>
  );
}
