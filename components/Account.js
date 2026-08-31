import { useState } from 'react';

// Signing in, in the drawer, in one step.
//
// Kept as short as it can be: an email, and that is the account. No password
// to invent, no code to wait for, no provider buttons. Phone is asked for
// once, optionally, and only because raffy wants it on the record — nothing
// signs in with it.
//
// Anonymous is a real state here, not a lapsed one. Someone who never signs in
// loses nothing they had before; they simply cannot reach their trips from a
// different phone, and the copy says exactly that rather than nagging.

export default function Account({ user, trips, onSignedIn, onSignOut }) {
  const [step, setStep] = useState('idle');   // idle | form | busy
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');

  const go = async () => {
    setErr(''); setStep('busy');
    try {
      const r = await fetch('/api/auth/signin', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        // The trips this browser is holding come along, so signing in after a
        // week of anonymous planning does not look like starting over.
        body: JSON.stringify({ email, phone, trips }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Could not open your account.'); setStep('form'); return; }
      onSignedIn(d);
      setStep('idle'); setPhone('');
    } catch (e) { setErr('Could not reach the server.'); setStep('form'); }
  };

  if (user) {
    return (
      <div className="acct in">
        <div className="who">
          <span className="av">{(user.email || '?')[0].toUpperCase()}</span>
          <span className="det">
            <b>{user.email}</b>
            <i>{user.phone || 'Trips follow you to any device'}</i>
          </span>
        </div>
        <button className="out" onClick={onSignOut}>Sign out</button>
        <style jsx>{css}</style>
      </div>
    );
  }

  return (
    <div className="acct">
      {step === 'idle' && (
        <button className="cta" onClick={() => setStep('form')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21a8 8 0 1 0-16 0" /><circle cx="12" cy="8" r="4" />
          </svg>
          <span><b>Save your trips</b><i>So you can open them on another phone</i></span>
        </button>
      )}

      {step !== 'idle' && (
        <div className="form">
          <label>Email</label>
          <input
            type="email" inputMode="email" autoFocus value={email} placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && email) go(); }}
          />
          <label>Phone <span className="opt">optional</span></label>
          <input
            type="tel" inputMode="tel" value={phone} placeholder="+60 12 345 6789"
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && email) go(); }}
          />
          <p className="note">
            No password and no code — your email is the account. Use the same one
            on another device and your trips are there.
          </p>
          {err && <p className="err">{err}</p>}
          <div className="row">
            <button className="ghost" onClick={() => { setStep('idle'); setErr(''); }}>Cancel</button>
            <button className="go" disabled={!email || step === 'busy'} onClick={go}>
              {step === 'busy' ? 'One moment…' : 'Save my trips'}
            </button>
          </div>
        </div>
      )}

      <style jsx>{css}</style>
    </div>
  );
}

// Scoped to .acct by hand.
//
// styled-jsx can only scope a static template literal. This one is a variable
// — `<style jsx>{css}</style>` — so it cannot be transformed, and every bare
// element selector in here goes GLOBAL. A plain `label{margin:0 0 5px}` was
// landing on the composer's paperclip label two components away and pushing it
// 2.5px off centre against the send button.
const css = `
  .acct{margin-bottom:6px}
  .cta{
    display:flex;align-items:center;gap:12px;width:100%;
    border:0;background:var(--surface);cursor:pointer;color:inherit;
    padding:12px 13px;border-radius:14px;box-shadow:var(--sh-s);
    font-family:inherit;text-align:left;transition:transform 150ms var(--e);
  }
  .cta:active{transform:scale(.985)}
  .cta svg{width:17px;height:17px;flex:none;color:var(--deep)}
  .cta span{display:flex;flex-direction:column;gap:2px;min-width:0}
  .cta b{font-size:14px;font-weight:650}
  .cta i{font-style:normal;font-size:11.5px;color:var(--ink-soft)}

  .form{background:var(--surface);border-radius:14px;padding:13px;box-shadow:var(--sh-s)}
  .acct label{
    display:block;font-size:11px;font-weight:750;letter-spacing:.06em;
    text-transform:uppercase;color:var(--ink-faint);margin:0 0 5px;
  }
  .acct label + input{margin-bottom:11px}
  .opt{text-transform:none;letter-spacing:0;font-weight:600;opacity:.75}
  .acct input{
    width:100%;border:0;background:var(--bg);border-radius:11px;padding:11px 12px;
    font-size:15px;font-family:inherit;color:var(--ink);outline:none;
  }
  .acct input:focus{box-shadow:0 0 0 2px var(--deep)}
  .note{margin:2px 0 11px;font-size:11.5px;line-height:1.45;color:var(--ink-faint)}
  .err{margin:0 0 10px;font-size:12.5px;line-height:1.4;color:#8C3B14}
  .row{display:flex;gap:7px}
  .row button{
    border:0;border-radius:99px;padding:10px 14px;font-size:13px;font-weight:650;
    cursor:pointer;font-family:inherit;
  }
  .ghost{background:var(--sage);color:var(--ink-soft)}
  .go{flex:1;background:var(--deep);color:#EAF2EC}
  .go:disabled{opacity:.45;cursor:default}

  .in{display:flex;align-items:center;gap:10px;background:var(--surface);
      border-radius:14px;padding:11px 12px;box-shadow:var(--sh-s)}
  .who{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
  .av{
    flex:none;width:30px;height:30px;border-radius:99px;background:var(--deep);
    color:#EAF2EC;display:grid;place-items:center;font-weight:700;font-size:13px;
  }
  .det{display:flex;flex-direction:column;gap:2px;min-width:0}
  .det b{font-size:13px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .det i{font-style:normal;font-size:11px;color:var(--ink-soft)}
  .out{
    flex:none;border:0;background:none;color:var(--ink-soft);font-size:12px;
    font-weight:650;cursor:pointer;padding:6px 8px;border-radius:9px;
  }
  .out:hover{background:var(--sage)}
`;
