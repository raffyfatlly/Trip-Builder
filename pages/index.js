import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { renderPreview, downloadName } from '../lib/preview.js';
import { applyEdits, countStale, loadEdits, saveEdits, forRender } from '../lib/edits.js';

// Measuring has to happen before the browser paints, not after. useEffect runs
// after, which leaves one frame where the new character is rendered at the old
// height — the textarea scrolls itself to fit and the end of the line appears
// to vanish. useLayoutEffect does not exist on the server, so fall back there.
const useMeasure = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import { loadTrips, rememberTrip, forgetTrip, loadMemory, saveMemory } from '../lib/trips.js';
import Editor from '../components/Editor.js';
import Block from '../components/Blocks.js';
import Onboard from '../components/Onboard.js';
import Plan from '../components/Plan.js';
import Drawer from '../components/Drawer.js';
import Rich from '../components/Rich.js';
import Actions from '../components/Actions.js';
import { applyMemory, editSlot, filledCount } from '../lib/memory.js';

const KEY = 'itin.session.v1';
const POLL_MS = 2000;
// The server can legitimately spend a while advancing the agent, but a poll
// that outlives this is not going to arrive. Give up, show something honest,
// and try again on the next tick.
const POLL_TIMEOUT_MS = 45000;
// How often to nudge the agent forward. Slower than the render poll on
// purpose: this one does the expensive work, and only one runs at a time.
const ADVANCE_MS = 2500;

export default function Home() {
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState([]);      // uploaded, not yet sent
  const [thinking, setThinking] = useState(false);
  // What the agent is doing, in its own words, and how long it has been at it.
  const [doing, setDoing] = useState(null);
  const [since, setSince] = useState(0);
  // Consecutive failed polls. A blank page after a refresh reads as "my trip
  // is gone" when the truth is "the server did not answer" — say which.
  const [stalled, setStalled] = useState(0);
  const [building, setBuilding] = useState(false);
  const [itinerary, setItinerary] = useState(null);
  const [preview, setPreview] = useState('');
  const [sheet, setSheet] = useState(false);       // itinerary open on mobile
  const [error, setError] = useState('');
  const [booting, setBooting] = useState(true);
  const [edits, setEdits] = useState([]);
  const [pane, setPane] = useState('preview');   // preview | edit
  const [staleNote, setStaleNote] = useState(0);
  // The composer, docked over the trip, so a change never costs you the view.
  const [dock, setDock] = useState(null);
  const [agentEdits, setAgentEdits] = useState([]);
  const [trips, setTrips] = useState([]);
  const [menu, setMenu] = useState(false);
  // "Save profile" has to land on the email field, not just open the drawer
  // and leave them hunting for it behind a collapsed row.
  const [signInNow, setSignInNow] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const [plan, setPlan] = useState({});
  const [skipOb, setSkipOb] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [hintOff, setHintOff] = useState(true);
  const [account, setAccount] = useState({ accounts: false, user: null });
  const [memory, setMemory] = useState(null);

  const router = useRouter();

  const scroller = useRef(null);
  const inputRef = useRef(null);
  const lastItinerary = useRef('');

  // --- session ------------------------------------------------------------
  useEffect(() => {
    setTrips(loadTrips());
    try { setHintOff(localStorage.getItem('itin.hint.attach') === 'off'); } catch (e) { setHintOff(false); }
    setMemory(loadMemory());

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

  // Who is signed in, and what does their account already hold. Runs once, and
  // failing is fine: no account simply means the browser's own list stands, the
  // way it did before accounts existed.
  useEffect(() => {
    let alive = true;
    fetch('/api/me')
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d) return;
        setAccount({ accounts: !!d.accounts, user: d.user || null });
        if (d.user && Array.isArray(d.trips)) mergeTrips(d.trips);
        // The account's profile wins on sign-in: it is the one that has
        // followed them across devices.
        if (d.user && d.memory) { saveMemory(d.memory); setMemory(d.memory); }
      })
      .catch(() => { /* anonymous, as before */ });
    return () => { alive = false; };
  }, []);



  // --- polling ------------------------------------------------------------
  useEffect(() => {
    if (!session) return;
    let alive = true;
    let timer;

    const tick = async () => {
      try {
        // The server holds this open while it advances the agent, and a poll
        // that never returns used to leave the page blank forever. Give up and
        // try again rather than waiting on it.
        const r = await fetch('/api/state?session=' + encodeURIComponent(session),
          { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) });
        if (!r.ok) throw new Error('state ' + r.status);
        const d = await r.json();
        if (!alive) return;
        if (d.transcript) setMessages(d.transcript);
        setThinking(!!d.thinking);
        setBuilding(!!d.building);
        setDoing(d.doing || null);
        if (d.itinerary) setItinerary(d.itinerary);
        setAgentEdits(d.agentEdits || []);
        setPlan(d.plan || {});
        if ((d.memoryOps || []).length) foldMemory(d.memoryOps);
        setLoaded(true);
        setStalled(0);
      } catch (e) {
        if (alive) setStalled((n) => n + 1);
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [session]);

  // The other half of the loop, kept away from the one that renders.
  //
  // /api/advance answers the agent's pending tool calls and takes the build
  // forward. It can legitimately run for minutes, so it gets its own slow
  // cadence and never blocks the poll above — which is the whole reason the
  // Italy trip came back blank. One at a time: a second call while the first
  // is still going would duplicate work and cost money twice.
  useEffect(() => {
    if (!session) return;
    let alive = true;
    let timer;
    let inFlight = false;

    const push = async () => {
      if (!inFlight) {
        inFlight = true;
        try {
          await fetch('/api/advance?session=' + encodeURIComponent(session), { method: 'POST' });
        } catch (e) { /* the next one retries; the page is unaffected */ }
        inFlight = false;
      }
      if (alive) timer = setTimeout(push, ADVANCE_MS);
    };
    push();
    return () => { alive = false; clearTimeout(timer); };
  }, [session]);

  // How long the current wait has been going. Reset whenever it stops working,
  // so the escalating copy below is about this wait, not the session.
  useEffect(() => {
    if (!thinking && !building) { setSince(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setSince(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [thinking, building]);

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

  // What to call this trip, in one place. The destination is known from the
  // moment the agent notes it, long before anything is built — and it must be
  // declared here, above every use: a const referenced from a hook's
  // dependency array higher up hits the temporal dead zone and takes the whole
  // page down.
  const tripName =
    (working && working.trip && working.trip.title)
    || (plan && plan.destination)
    || '';

  // Keep this browser's trip list current. The label is the destination once
  // the itinerary exists, and before that the first thing they typed — an
  // unbuilt trip is still worth being able to get back to.
  const lastLabel = useRef('');
  useEffect(() => {
    if (!session || !messages.length) return;
    // Best name available, in order: what the built itinerary calls itself,
    // then the destination the agent has settled on. The first line they typed
    // is the last resort — "We're going to Da Nang, 10 September 2026 to 14
    // September" is a sentence, not a name, and it reads badly in a list.
    const label = tripName
      || (messages.find((m) => m.role === 'user') || {}).text?.replace(/\s+/g, ' ').slice(0, 42)
      || '';
    if (!label || label === lastLabel.current) return;
    lastLabel.current = label;
    rememberTrip(session, label);
    setTrips(loadTrips());
    if (account.user) {
      fetch('/api/me', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claim: { id: session, label } }),
      }).catch(() => { /* the local list is still right */ });
    }
  }, [session, tripName, messages, account.user]);

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

  // "Change this" from inside the preview.
  //
  // raffy, 2026-09-01: "give the button to chat , then auto interactive message
  // send to chat . chat agent then make the edits."
  //
  // Handed to the composer rather than sent, with the cursor after it. The
  // agent cannot act on "Change dinner:" alone, and a message that fires on tap
  // would be a question with no question in it — the same mistake as an option
  // chip that sends itself.
  useEffect(() => {
    const onAsk = (e) => {
      const text = e && e.data && e.data.tripAsk;
      if (typeof text !== 'string' || !text) return;
      // Stay on the trip. raffy, 2026-09-01: "for mobile we need to find better
      // way where chat can exist in the same page , especially on the change
      // this part... i just want the chat continues to live in the app."
      //
      // Bouncing to the chat to type one sentence loses the thing you were
      // looking at, which is the whole context of the change. The composer
      // comes to the trip instead, as a dock over the bottom of it.
      setDock({ text, sending: false });
    };
    window.addEventListener('message', onAsk);
    return () => window.removeEventListener('message', onAsk);
  }, []);

  const dockRef = useRef(null);
  // What the agent last said, trimmed to something that fits a dock. The point
  // of answering here is that the reply does not happen offscreen.
  const lastAgentLine = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'assistant' || !m.text) continue;
      const line = String(m.text).split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
      return line.length > 130 ? line.slice(0, 128) + '…' : line;
    }
    return '';
  })();


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

  // Follow the conversation down, but only while they are actually at the
  // bottom. The poll fires every two seconds, and unconditionally scrolling on
  // each one made reading back through the chat impossible on a phone — you
  // scrolled up and were yanked to the end again a moment later.
  const pinned = useRef(true);
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // A little slack: "near the bottom" counts as at it, so momentum scrolling
    // and rubber-banding do not unpin you by a pixel.
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, thinking, building]);

  // Sending is the one moment to override that: their own message should
  // always bring them back to the bottom.
  const stickToBottom = () => { pinned.current = true; };

  // The box grows with what they write, up to a point, then scrolls. Height
  // has to be reset to auto first or it can only ever get taller — shrinking
  // back after a delete would not work.
  const grow = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const h = el.scrollHeight;
    el.style.height = Math.min(h, 168) + 'px';
    // Past one line the controls drop to their own row underneath, so the
    // text gets the full width instead of threading between two buttons.
    // Measured against the line height rather than a fixed pixel count, so it
    // holds if the type size ever changes.
    // scrollHeight includes the padding, so compare like with like — measuring
    // the raw value against one line made an EMPTY box look like two lines.
    const cs = getComputedStyle(el);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const line = parseFloat(cs.lineHeight) || 22;
    const lines = (h - pad) / line;
    // Tall latches until the box is empty, and that is the whole fix.
    //
    // Going tall moves the two buttons onto their own row, so the textarea
    // gets about 96px WIDER. Text that had just wrapped to a second line then
    // fits on one again — which says "go short" — which narrows it — which
    // wraps it. The composer flip-flopped on every keystroke for the whole
    // end of the first line, and settled only once the text was long enough
    // to wrap at both widths. Measured here: thirteen switches in one line.
    //
    // No threshold can fix that, because the measurement is downstream of the
    // thing it decides. Breaking the loop is the fix: once it has grown it
    // stays grown until they send or clear, which is also what anyone would
    // expect a text box to do mid-sentence.
    // (raffy, 2026-09-01: "as i was writing the first line, at the end, some
    // words and letters go missing, and glitch. only after finishing that last
    // few lines and moving to second line it will stabilise again.")
    setTall((was) => (!el.value ? false : was || lines > 1.7));
  }, []);

  useMeasure(() => { grow(); }, [draft, grow]);

  // The height was measured once at mount and then only when they typed. The
  // conversation loading in above it, a font finishing its swap, the keyboard
  // opening — none of those change `draft`, so none of them re-measured, and
  // a stale height just sat there through all of it.
  useEffect(() => {
    grow();
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    window.addEventListener('resize', grow);
    if (vv) vv.addEventListener('resize', grow);
    if (typeof document !== 'undefined' && document.fonts) {
      Promise.resolve(document.fonts.ready).then(grow).catch(() => {});
    }
    return () => {
      window.removeEventListener('resize', grow);
      if (vv) vv.removeEventListener('resize', grow);
    };
  }, [grow]);

  useEffect(() => { grow(); }, [messages.length, grow]);

  // On a phone there is no shift key, so Enter cannot mean "send" — it has to
  // mean a new line, or you can never write a second paragraph. With a real
  // keyboard Enter still sends and shift+Enter breaks the line, which is what
  // anyone typing at a desk expects.
  const [tall, setTall] = useState(false);

  // Switching to tall changes the width, so the height measured a moment ago
  // was for the old layout. Re-measure once the class has actually landed.
  // Safe from looping now that tall only latches one way.
  useMeasure(() => { grow(); }, [tall, grow]);
  const [hasKeyboard, setHasKeyboard] = useState(false);
  useEffect(() => {
    try { setHasKeyboard(window.matchMedia('(hover: hover) and (pointer: fine)').matches); }
    catch (e) { setHasKeyboard(false); }
  }, []);

  // --- sending ------------------------------------------------------------
  const send = useCallback(async (override) => {
    const text = typeof override === 'string' ? override : draft.trim();
    if ((!text && !pending.length) || !session) return;

    stickToBottom();

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
          session, text, files, memory,
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
    setMenu(false);
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    location.reload();
  };

  // Switching trips reloads rather than swapping state in place: everything on
  // this page hangs off the session id, and a reload is the one way to be sure
  // none of the old trip is left behind.
  const openTrip = (id) => {
    if (id === session) { setMenu(false); return; }
    try { localStorage.setItem(KEY, id); } catch (e) { /* ignore */ }
    location.reload();
  };

  // The agent's remember/forget calls arrive as ops replayed from the chat
  // log. Folding them here, rather than storing a profile on the server, keeps
  // the same stateless shape as the itinerary edits.
  const seenOps = useRef(new Set());
  const foldMemory = (ops) => {
    const fresh = ops.filter((o) => !seenOps.current.has(o.id));
    if (!fresh.length) return;
    fresh.forEach((o) => seenOps.current.add(o.id));
    setMemory((prev) => {
      const next = fresh.reduce((m, o) => applyMemory(m, o.name, o.input), prev);
      persistMemory(next);
      return next;
    });
  };

  const persistMemory = (next) => {
    saveMemory(next);
    if (account.user) {
      fetch('/api/me', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memory: next }),
      }).catch(() => { /* the local copy still stands */ });
    }
  };

  const forgetSlot = (key) => {
    setMemory((prev) => {
      const next = applyMemory(prev, 'forget', { fields: [key] });
      persistMemory(next);
      return next;
    });
  };

  const editSlotByHand = (key, text) => {
    setMemory((prev) => {
      const next = editSlot(prev, key, text);
      persistMemory(next);
      return next;
    });
  };

  const forgetAll = () => {
    setMemory(null);
    persistMemory(null);
  };

  // Asking to save the profile, without becoming a nag.
  //
  // Signed out, everything still works — the profile just lives in this
  // browser. So this is an offer, not a wall, and it is only worth making once
  // there is something to lose: a few things known, and asked again only after
  // the profile has GROWN since they last said no. Dismissing it does not
  // silence it forever, and agreeing to it never blocks anything.
  const NUDGE_KEY = 'itin.saveprofile.v1';
  const [nudgeAt, setNudgeAt] = useState(null);
  useEffect(() => {
    try { setNudgeAt(Number(localStorage.getItem(NUDGE_KEY) || 0)); } catch (e) { setNudgeAt(0); }
  }, []);

  const known = filledCount(memory);
  const nudge = account.accounts && !account.user && nudgeAt !== null && known >= 3 && known > nudgeAt + 1;

  const nudgeLater = () => {
    setNudgeAt(known);
    try { localStorage.setItem(NUDGE_KEY, String(known)); } catch (e) { /* ignore */ }
  };

  // The account's trips and this browser's are both real. Union them, newest
  // label wins, so signing in never hides work and signing out never loses it.
  const mergeTrips = (remote) => {
    for (const t of remote) rememberTrip(t.id, t.label);
    setTrips(loadTrips());
  };

  const onSignedIn = (d) => {
    setAccount({ accounts: true, user: d.user || null });
    if (Array.isArray(d.trips)) mergeTrips(d.trips);
  };

  const onSignOut = async () => {
    try { await fetch('/api/auth/signout', { method: 'POST' }); } catch (e) { /* ignore */ }
    // The local list stays. Signing out is not "delete my trips".
    setAccount((a) => ({ ...a, user: null }));
  };

  const dropTrip = (id) => {
    forgetTrip(id);
    setTrips(loadTrips());
    if (account.user) {
      fetch('/api/me', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ forget: id }),
      }).catch(() => { /* ignore */ });
    }
  };

  // The builder can land save_itinerary before it has written any days, so an
  // itinerary object alone is not enough to show. Wait for a real day.
  const ready = !!(working && working.days && working.days.length > 0);
  const title = tripName || null;

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

  // Nobody thinks to send a booking confirmation to a chat box. The paperclip
  // is right there and still invisible, so say it once, while it is useful —
  // when flights or a hotel are the thing still missing.
  const showHint =
    !hintOff && !onboarding && messages.length > 0 && !ready &&
    (!plan.flights || !plan.stays);

  const dismissHint = () => {
    setHintOff(true);
    try { localStorage.setItem('itin.hint.attach', 'off'); } catch (e) { /* ignore */ }
  };

  return (
    <div className="app">
      <header className="bar">
        <button className="burger" onClick={() => setMenu(true)} aria-label="Menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h11" />
          </svg>
        </button>

        {/* The trip's own name once it has one. A wordmark tells you nothing
            you did not already know; the destination tells you which trip. */}
        <span className="where">{title || 'Trip builder'}</span>

        {ready ? (
          <button className="itbtn" onClick={openSheet} aria-label="Itinerary" title="Itinerary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            {unseen && <i className="ping" />}
          </button>
        ) : <span className="spacer" />}
      </header>

      <main className="split">
        <section className={'chat' + (sheet ? ' hidden-m' : '')}>
          {onboarding ? (
            <Onboard
              memory={memory}
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
          <div className="scroll" ref={scroller} onScroll={onScroll}>
            {booting && <div className="sys">Starting…</div>}

            {!booting && messages.length === 0 && skipOb && (
              <div className="intro">
                <h1>Where are you going?</h1>
                {/* What the two halves of this thing are, in two lines.
                    raffy, 2026-09-01: "important also id to make it clear to
                    user how to use the whole app . like agents fot them to be
                    consulted... and the app itself is the app that have all
                    their plans , decision and everything displayed nicely."
                    Said once, here, where somebody is deciding whether to
                    bother — not as a tour nobody reads. */}
                <div className="how">
                  <div className="hrow">
                    <span className="hn">Talk to me</span>
                    <span>Ask anything, any time — what a hotel really costs, whether
                      it rains that week, what is worth the trip out. I look it up.</span>
                  </div>
                  <div className="hrow">
                    <span className="hn">Get your own app</span>
                    <span>Everything we settle turns into a trip app that is yours:
                      the days, the places, and what is still left to book.</span>
                  </div>
                </div>
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
                <Block key={m.id} block={m} disabled={thinking} where={tripName} onChoose={(t) => send(t)} />
              ) : (
                <div key={m.id} className={'msg ' + m.role}>
                  {m.role === 'assistant' ? (
                    <>
                      <Rich text={m.text} />
                      <Actions actions={m.actions} />
                    </>
                  ) : m.text.split('\n').map((line, i) => <p key={i}>{line}</p>)}
                </div>
              )
            ))}

            {thinking && (
              <div className="msg assistant typing">
                <span className="dots"><span /><span /><span /></span>
                {/* Says what it is actually doing, from the event log — not a
                    rotating list of invented phrases. After a minute it stops
                    pretending this is normal and says so, because a status that
                    keeps reassuring you through a genuine hang is worse than
                    three dots. (raffy, 2026-09-01) */}
                <span className="says">
                  {stalled > 2
                    ? "Lost the connection — still trying"
                    : since > 120
                      ? (doing || 'Still working') + " — longer than usual, it hasn't given up"
                      : since > 25
                        ? (doing || 'Thinking') + ' — this one is taking a moment'
                        : (doing || 'Thinking')}
                </span>
              </div>
            )}
            {building && (
              <div className="working">
                <span className="spin" />
                {since > 240
                  ? 'Still building your itinerary. It is a big one — this can take a few minutes.'
                  : 'Building your itinerary. This takes a couple of minutes.'}
              </div>
            )}

            {/* A build takes minutes, so it lands while they are looking at
                something else. Saying "it's done" in the header dot is easy to
                miss — this puts the way in at the end of the conversation,
                where they are already reading, and goes away once opened. */}
            {ready && unseen && !building && (
              <div className="done">
                <div className="donetext">
                  <b>{title ? title + ' is ready' : 'Your itinerary is ready'}</b>
                  <span>Day by day, with times, weather and everything you can edit.</span>
                </div>
                <button onClick={openSheet}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
                  </svg>
                  Open it
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="err" onClick={() => setError('')}>{error} <b>Dismiss</b></div>
          )}

          {showHint && (
            <div className="hint">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5" />
              </svg>
              <span>
                Got a booking confirmation? Send the screenshot, PDF or email —
                flight times, hotel address, all of it gets read.
              </span>
              <button onClick={dismissHint} aria-label="Dismiss">×</button>
            </div>
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
            <div className={'row' + (tall ? ' tall' : '')}>
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
                placeholder={messages.length ? "Reply, or attach a booking" : "Tell me about your trip"}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey) return;
                  // Mid-composition in an IME, Enter is choosing a candidate.
                  if (e.nativeEvent && e.nativeEvent.isComposing) return;
                  if (!hasKeyboard) return;             // phone: Enter is a new line
                  e.preventDefault();
                  send();
                }}
              />
              <button className="sendbtn" onClick={send} aria-label="Send"
                disabled={!draft.trim() && !pending.length}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20V5M5 12l7-7 7 7" />
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

          {/* The Preview/Edit toggle is gone. Changing something is a button on
              the thing itself now, which asks the agent — not a mode you switch
              into and hunt for the same item in a list of form fields.
              Photos stay by hand: the agent cannot see a picture, and choosing
              one is genuinely faster than describing it. */}
          {ready && (
            <div className="seg">
              <button className={pane === 'preview' ? 'on' : ''}
                onClick={() => setPane('preview')}>Your trip</button>
              <button className={pane === 'photos' ? 'on' : ''}
                onClick={() => setPane('photos')}>Photos</button>
            </div>
          )}

          {staleNote > 0 && (
            <div className="stale">
              {staleNote === 1 ? 'One of your changes did not' : staleNote + ' of your changes did not'} fit
              the new version of the trip, so it was left out.
              <button onClick={undoEdits}>Undo my changes</button>
            </div>
          )}

          {ready && pane === 'photos' ? (
            <div className="editwrap">
              <Editor itinerary={working} onOp={applyOp} photosOnly />
            </div>
          ) : (
            <div className="phone">
              {/* The chat, docked over the trip rather than instead of it.
                  It carries the last thing the agent said, so a change you ask
                  for here is answered here — the conversation keeps going
                  without the trip ever leaving the screen. */}
              {dock && (
                <div className="dock">
                  <button className="dx" onClick={() => setDock(null)} aria-label="Close">×</button>
                  {dock.sending ? (
                    <div className="dsay">
                      {thinking
                        ? <><i className="dd" /><i className="dd" /><i className="dd" /><span>Working on it</span></>
                        : <span>{lastAgentLine || 'Done — have a look.'}</span>}
                      <button className="dfull" onClick={() => { setDock(null); setSheet(false); }}>
                        Open chat
                      </button>
                    </div>
                  ) : (
                    <form
                      className="drow"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const t = (dockRef.current ? dockRef.current.value : dock.text).trim();
                        if (!t) return;
                        send(t);
                        setDock({ text: '', sending: true });
                      }}
                    >
                      <textarea
                        ref={dockRef}
                        rows={2}
                        defaultValue={dock.text}
                        autoFocus
                        placeholder="What should change?"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            e.currentTarget.form.requestSubmit();
                          }
                        }}
                      />
                      <button type="submit" aria-label="Send">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                          strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                      </button>
                    </form>
                  )}
                </div>
              )}
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

      <Drawer
        open={menu}
        onClose={() => { setMenu(false); setSignInNow(false); }}
        trips={trips}
        session={session}
        onOpenTrip={openTrip}
        onDrop={dropTrip}
        onNew={startOver}
        onDownload={() => { setMenu(false); download(); }}
        canDownload={ready}
        memory={memory}
        onEditSlot={editSlotByHand}
        onForgetSlot={forgetSlot}
        onForgetAll={forgetAll}
        nudge={nudge}
        onNudgeSave={() => { nudgeLater(); setMenu(true); setSignInNow(true); }}
        signInNow={signInNow}
        onNudgeLater={nudgeLater}
        accounts={account.accounts}
        user={account.user}
        onSignedIn={onSignedIn}
        onSignOut={onSignOut}
      />

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
          display:flex;align-items:center;gap:10px;
          padding:calc(12px + env(safe-area-inset-top)) 16px 12px;
          flex:none;
        }

        .burger{
          flex:none;border:0;background:var(--surface);color:var(--ink);cursor:pointer;
          width:36px;height:36px;border-radius:12px;display:grid;place-items:center;
          box-shadow:var(--sh-s);transition:transform 150ms var(--e);
        }
        .burger:active{transform:scale(.94)}
        .burger svg{width:17px;height:17px}

        /* The title takes whatever is left and truncates. Nothing in this row
           may push the row wider than the screen. */
        .where{
          flex:1;min-width:0;text-align:center;font-weight:700;font-size:15px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 4px;
        }
        .spacer{flex:none;width:36px}

        /* An icon, not a word. It sits opposite the burger and reads as its
           pair, which leaves the whole middle of the bar for the trip's name —
           the one thing there worth reading. */
        .itbtn{
          position:relative;flex:none;display:grid;place-items:center;
          width:36px;height:36px;border:0;border-radius:12px;
          background:var(--deep);color:#EAF2EC;box-shadow:var(--sh-s);
          cursor:pointer;transition:transform 150ms var(--e);
        }
        .itbtn:active{transform:scale(.94)}
        .itbtn svg{width:17px;height:17px}
        .ping{
          position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:99px;
          background:var(--coral);border:2px solid var(--bg);
        }

        .split{flex:1;display:flex;min-height:0;gap:20px;padding:0 16px 0}

        .chat{flex:1;display:flex;flex-direction:column;min-height:0;min-width:0}
        .scroll{flex:1;overflow-y:auto;padding:6px 2px 10px;scroll-behavior:smooth}

        .intro{padding:26px 4px 10px;max-width:30ch}
        /* Over the trip, not instead of it. Anchored to the bottom because
           that is where a keyboard comes from on a phone. */
        .dock{
          position:absolute;left:10px;right:10px;bottom:10px;z-index:5;
          background:var(--surface);border-radius:20px;padding:12px 12px 11px;
          box-shadow:0 2px 6px rgba(12,36,27,.08), 0 18px 40px -20px rgba(12,36,27,.55);
        }
        .dock .dx{
          position:absolute;right:9px;top:7px;border:0;background:none;padding:2px 5px;
          font-size:17px;line-height:1;color:var(--ink-faint);cursor:pointer;
        }
        .drow{display:flex;gap:9px;align-items:flex-end}
        .drow textarea{
          flex:1;min-width:0;border:0;background:var(--sage);border-radius:14px;
          padding:10px 12px;font-size:15px;font-family:inherit;color:var(--ink);
          outline:0;resize:none;line-height:1.45;
        }
        .drow textarea:focus{box-shadow:0 0 0 2px var(--coral)}
        .drow button{
          flex:none;width:38px;height:38px;border:0;border-radius:50%;cursor:pointer;
          background:var(--deep);color:#EAF2EC;display:grid;place-items:center;
        }
        .drow button svg{width:17px;height:17px}
        .dsay{display:flex;align-items:center;gap:7px;font-size:13.5px;color:var(--ink-soft);padding-right:18px}
        .dsay span{flex:1;min-width:0;line-height:1.45}
        .dsay .dd{
          width:5px;height:5px;border-radius:50%;background:var(--ink-faint);flex:none;
          animation:dbl 1.2s var(--e,ease) infinite;
        }
        .dsay .dd:nth-child(2){animation-delay:.15s}
        .dsay .dd:nth-child(3){animation-delay:.3s}
        @keyframes dbl{0%,60%,100%{opacity:.25}30%{opacity:1}}
        @media (prefers-reduced-motion:reduce){ .dsay .dd{animation:none} }
        .dfull{
          flex:none;border:0;background:var(--sage);color:var(--deep);border-radius:99px;
          padding:6px 12px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;
        }

        .how{display:flex;flex-direction:column;gap:12px;margin:2px 0 22px}
        .hrow{display:flex;flex-direction:column;gap:3px}
        .hrow .hn{
          font-size:11px;font-weight:750;letter-spacing:.07em;text-transform:uppercase;
          color:var(--coral-text,#AE4715);
        }
        .hrow span:last-child{font-size:14px;line-height:1.5;color:var(--ink-soft)}

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
          font-size:15px;line-height:1.55;margin:9px 0;
          animation:rise 260ms var(--e) both;
        }
        .msg p{margin:0}
        .msg p + p{margin-top:9px}

        /* The agent gets the page; only the traveller gets a bubble.
           (raffy, 2026-08-31: "agent is just taking the whole space just like
           this claude session.") Two speakers of equal weight in matching
           bubbles reads as a transcript. One voice on the page and the other
           in a bubble reads as someone talking to you — and it gives long
           replies, lists and prices the full column to breathe in. */
        .msg.assistant{max-width:60ch;padding:2px 2px 4px}

        .msg.user{
          max-width:min(80%,44ch);width:fit-content;margin-left:auto;
          padding:11px 15px;border-radius:20px;border-bottom-right-radius:8px;
          background:var(--deep);color:#EAF2EC;box-shadow:var(--sh-m);
        }
        @keyframes rise{from{opacity:0;transform:translateY(7px) scale(.985)}to{opacity:1;transform:none}}

        .typing{
          display:flex;gap:10px;align-items:center;width:fit-content;max-width:none;
          padding:10px 2px;
        }
        .typing .dots{display:flex;gap:5px;align-items:center;flex:none}
        .typing .dots span{
          width:7px;height:7px;border-radius:99px;background:var(--ink-faint);opacity:.45;
          animation:bob 1.15s infinite;
        }
        .typing .dots span:nth-child(2){animation-delay:.14s}
        .typing .dots span:nth-child(3){animation-delay:.28s}
        .typing .says{
          font-size:13px;line-height:1.4;color:var(--ink-faint);
          animation:fadein 300ms var(--e) both;
        }
        @keyframes fadein{from{opacity:0}to{opacity:1}}
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

        /* What the agent's messages are allowed to look like. A price gets
           weight because it is the thing people scan for; everything else
           stays quiet. */
        .msg :global(strong){font-weight:700}
        .msg :global(.cost){
          font-family:'Outfit',sans-serif;font-weight:700;font-size:14.5px;
          color:var(--coral-text,#AE4715);
        }
        .msg.user :global(.cost){color:#F4C4A8}
        .msg :global(a){color:inherit;text-decoration:underline;text-underline-offset:2px}
        .msg :global(a):hover{text-decoration-thickness:2px}

        .done{
          display:flex;flex-direction:column;gap:11px;align-items:flex-start;
          margin:10px 0;padding:15px 16px;max-width:min(92%,44ch);
          background:var(--deep);color:#E7EFE9;border-radius:20px;
          box-shadow:var(--sh-m);animation:rise 320ms var(--e) both;
        }
        .donetext{display:flex;flex-direction:column;gap:4px}
        .donetext b{font-size:15px;font-weight:700;font-family:'Outfit',sans-serif}
        .donetext span{font-size:12.5px;line-height:1.45;color:#B9CFC1}
        .done button{
          display:inline-flex;align-items:center;gap:8px;border:0;
          background:#EAF2EC;color:var(--deep);font-family:inherit;
          font-size:13.5px;font-weight:650;padding:10px 16px;border-radius:99px;
          cursor:pointer;transition:transform 150ms var(--e);
        }
        .done button:active{transform:scale(.96)}
        .done button svg{width:15px;height:15px}

        .hint{
          display:flex;align-items:flex-start;gap:9px;margin:0 2px 8px;
          background:var(--sage);border-radius:14px;padding:10px 11px;
          font-size:12.5px;line-height:1.45;color:var(--ink-soft);
          animation:rise 300ms var(--e) both;
        }
        .hint svg{width:14px;height:14px;flex:none;margin-top:2px;color:var(--deep)}
        .hint span{flex:1;min-width:0}
        .hint button{
          flex:none;border:0;background:none;color:var(--ink-faint);cursor:pointer;
          font-size:16px;line-height:1;padding:0 2px;opacity:.6;
        }
        .hint button:hover{opacity:1}

        .composer{flex:none;padding:8px 0 calc(12px + env(safe-area-inset-bottom))}
        .chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:9px}
        .chip{
          display:inline-flex;align-items:center;gap:7px;background:var(--sage);
          padding:7px 8px 7px 13px;border-radius:99px;font-size:12.5px;color:var(--ink-soft);
        }
        .chip button{border:0;background:none;font-size:16px;line-height:1;color:var(--ink-faint);cursor:pointer;padding:0 3px}
        .row{
          display:flex;align-items:center;gap:8px;background:var(--surface);
          border-radius:26px;padding:7px 7px 7px 6px;box-shadow:var(--sh-m);
        }

        /* Once the message wraps, the buttons drop to a row of their own and
           the text takes the full width. Threading a paragraph through a gap
           between two round buttons wastes the line and reads badly.
           (raffy, 2026-08-31: "the text move up and the icons stay down
           rather than it stays in line.") */
        .row.tall{
          display:grid;grid-template-columns:1fr auto;grid-template-areas:'text text' 'attach send';
          gap:4px 8px;border-radius:22px;padding:4px 7px 7px;
        }
        .row.tall textarea{grid-area:text;padding:9px 6px 2px}
        .row.tall .attach{grid-area:attach;justify-self:start}
        .row.tall .sendbtn{grid-area:send}
        /* Explicit flex centring, not place-items. The grid shorthand is the
           kind of thing that resolves fine in one engine and drifts by a
           pixel or two in another, and this is a 42px circle where a pixel
           shows. */
        .attach{
          width:42px;height:42px;flex:none;padding:0;cursor:pointer;
          display:flex;align-items:center;justify-content:center;
          color:var(--ink-faint);border-radius:99px;transition:background 160ms;
        }
        .attach:hover{background:var(--sage)}
        .attach input{display:none}
        .attach svg{width:19px;height:19px;display:block;flex:none}
        textarea{
          flex:1;min-width:0;border:0;outline:0;resize:none;background:none;
          font-size:16px;line-height:1.45;color:var(--ink);
          font-family:inherit;max-height:168px;overflow-y:auto;
          -webkit-appearance:none;appearance:none;
          /* Even padding, and the row centres it against the buttons with
             flex. Padding hand-matched to one line-height number only ever
             held on the machine it was measured on. */
          padding:11px 4px;
          /* Gone rather than thinned. "thin" is a suggestion the phone is
             free to ignore, and it was still a slab on his. Nothing here
             needs a visible track — it scrolls by touch. */
          scrollbar-width:none;
          -ms-overflow-style:none;
        }
        textarea::-webkit-scrollbar{display:none;width:0;height:0}
        textarea::placeholder{color:var(--ink-faint)}
        /* padding:0 and appearance:none here rather than on every button:
           an unstyled control keeps the browser's own padding until it is
           told not to, and border-box then takes that out of the 42px
           unevenly. Scoped to this button so nothing else inherits it. */
        .sendbtn{
          width:42px;height:42px;flex:none;border:0;padding:0;border-radius:99px;
          background:var(--coral);color:#fff;cursor:pointer;
          display:flex;align-items:center;justify-content:center;
          -webkit-appearance:none;appearance:none;
          transition:transform 160ms var(--e),opacity 160ms;
        }
        .sendbtn svg{width:19px;height:19px;display:block;flex:none}
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
          /* position:relative so the docked composer can sit over the trip
             rather than pushing it up. */
          position:relative;
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
          .how{display:flex;flex-direction:column;gap:12px;margin:2px 0 22px}
        .hrow{display:flex;flex-direction:column;gap:3px}
        .hrow .hn{
          font-size:11px;font-weight:750;letter-spacing:.07em;text-transform:uppercase;
          color:var(--coral-text,#AE4715);
        }
        .hrow span:last-child{font-size:14px;line-height:1.5;color:var(--ink-soft)}

        .intro h1{font-size:30px}
        }
        @media (min-width:861px){
          .itbtn{display:none}
          .spacer{display:none}
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
