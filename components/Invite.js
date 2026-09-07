import { useEffect, useState } from 'react';

// Planning a trip WITH somebody, rather than showing it to them.
//
// raffy, 2026-09-07: "user can share a specific session with other user. and
// built a good mechanism to allow this and allow the value of the app to
// increase."
//
// The share link next to this hands out a read-only copy. This hands out the
// trip itself: an invited person opens it in their own app, talks to the agent
// in it, and changes it. That is the difference between sending someone your
// plan and planning together.
//
// Two things this says out loud, because both are decisions somebody would
// otherwise discover by surprise:
//
//   The person needs an account with the address you type. There is no
//   forwardable link, so the owner always knows exactly who is in and can take
//   one person out without disturbing anyone else.
//
//   They spend their own credits, not yours. That is what makes it safe to
//   invite four people, and it is why this grows the app rather than costing
//   the person who started the trip.
export default function Invite({ session, canShare }) {
  const [state, setState] = useState(null);   // { owner, guests, mine }
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    if (!session || !canShare) { setState(null); return undefined; }
    fetch('/api/access?s=' + encodeURIComponent(session))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setState(d); })
      .catch(() => { /* not shareable is not an error worth showing */ });
    return () => { alive = false; };
  }, [session, canShare]);

  // Only the owner sees the controls. A guest is told they are a guest, which
  // answers "why can I not invite anyone" before it is asked.
  if (!state || !state.owner) return null;

  const send = async (addr, invited) => {
    setBusy(true);
    setNote('');
    try {
      const r = await fetch('/api/access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session, [invited ? 'invite' : 'revoke']: addr }),
      });
      const d = await r.json();
      if (!r.ok) setNote(d.error || 'Could not do that.');
      else { setState(d); setEmail(''); setNote(invited ? 'Invited.' : 'Removed.'); }
    } catch (e) {
      setNote('Could not reach the server.');
    }
    setBusy(false);
  };

  if (!state.mine) {
    return (
      <div className="inv">
        <p className="guest">Shared with you by {state.owner}. You can plan in it —
          your own credits pay for what you do here.</p>
        <style jsx>{`
          .inv{padding:2px 2px 4px}
          .guest{margin:0;font-size:12px;line-height:1.5;color:var(--ink-soft)}
        `}</style>
      </div>
    );
  }

  return (
    <div className="inv">
      <b>Plan it together</b>
      <i>They open it in their own app and can change it. They need an account
        with this address, and they spend their own credits — not yours.</i>

      <form
        className="row"
        onSubmit={(e) => { e.preventDefault(); if (email.trim()) send(email.trim(), true); }}
      >
        <input
          type="email" inputMode="email" autoComplete="off"
          placeholder="their email" value={email} disabled={busy}
          onChange={(e) => { setEmail(e.target.value); setNote(''); }}
        />
        <button type="submit" disabled={busy || !email.trim()}>Invite</button>
      </form>

      {note && <p className="note">{note}</p>}

      {(state.guests || []).length > 0 && (
        <ul>
          {state.guests.map((g) => (
            <li key={g}>
              <span>{g}</span>
              <button type="button" onClick={() => send(g, false)} disabled={busy}
                aria-label={'Remove ' + g}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      <style jsx>{`
        .inv{padding:11px 13px;background:var(--surface);border-radius:14px;
             box-shadow:var(--sh-s);display:flex;flex-direction:column;gap:7px}
        b{font-size:13.5px;font-weight:700;color:var(--ink)}
        i{font-style:normal;font-size:11.5px;line-height:1.45;color:var(--ink-soft)}
        .row{display:flex;gap:6px;margin-top:2px}
        input{
          flex:1;min-width:0;border:0;background:var(--well);border-radius:10px;
          padding:9px 11px;font-size:13.5px;font-family:inherit;color:var(--ink);outline:0;
        }
        input:focus{box-shadow:0 0 0 2px var(--coral)}
        .row button{
          flex:none;border:0;border-radius:10px;padding:0 13px;cursor:pointer;
          background:var(--deep);color:#EAF2EC;font-size:13px;font-weight:650;font-family:inherit;
        }
        .row button:disabled{opacity:.45;cursor:default}
        .note{margin:0;font-size:11.5px;color:var(--ink-soft)}
        ul{list-style:none;margin:2px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
        li{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-soft)}
        li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        li button{
          flex:none;border:0;background:none;padding:2px 4px;cursor:pointer;
          font-size:11.5px;font-weight:650;color:var(--ink-faint);font-family:inherit;
        }
        li button:hover{color:var(--ink)}
      `}</style>
    </div>
  );
}
