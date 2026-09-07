import { useEffect, useRef, useState } from 'react';

// Signing up and signing in, as a proper dialog.
//
// raffy, 2026-09-06: "Implement proper sign-up and sign-in pop-ups and buttons
// on the frontend, while leaving the existing backend authentication mechanism
// intact for now."
//
// So the SERVER is untouched. Both modes post to /api/auth/signin exactly as
// the drawer form did — same body, same response, same cookie. Everything new
// here is the way in: a dialog you can actually find, and buttons that say what
// they do, instead of one folded row at the bottom of a menu.
//
// REQUIRED mode (raffy, 2026-09-06: "actually just make sure they have email
// to start using") turns the same dialog into the door: no close button, no
// escape, no tapping outside. It is only ever shown before a trip exists —
// someone already mid-conversation is never locked out of work they have
// already done and already paid for.
//
// ONE HONEST NOTE, and it is worth raffy reading. The endpoint is findOrCreate:
// one call that makes the account if the email is new and opens it if it is
// not. So the two tabs below are the same request. Someone who taps "Sign in"
// with an address they have never used gets an account created for them, and
// someone who taps "Sign up" with an address they already used is simply let
// back in. Neither is wrong, and neither is a lie in the copy — nothing here
// claims the account already exists or that it is new — but the tabs cannot be
// enforced until the server distinguishes them. Left as-is deliberately.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function Auth({ open, mode, trips, required, onClose, onSignedIn }) {
  const [tab, setTab] = useState(mode === 'signin' ? 'signin' : 'signup');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const field = useRef(null);
  const panel = useRef(null);

  // Reopening on the other tab has to actually land there, and a stale error
  // from last time is not about anything they are looking at now.
  useEffect(() => {
    if (!open) return;
    setTab(mode === 'signin' ? 'signin' : 'signup');
    setErr('');
    setBusy(false);
    const t = setTimeout(() => field.current && field.current.focus(), 60);
    return () => clearTimeout(t);
  }, [open, mode]);

  // Escape closes it, and while it is open the page behind does not scroll —
  // on a phone a dialog over a scrolling page is how you lose your place in the
  // conversation.
  useEffect(() => {
    if (!open) return;
    const key = (e) => { if (e.key === 'Escape' && !required) onClose(); };
    document.addEventListener('keydown', key);
    const had = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = had;
    };
  }, [open, onClose, required]);

  if (!open) return null;

  const ok = EMAIL.test(email.trim());
  const isUp = tab === 'signup';

  const go = async () => {
    if (!ok || busy) return;
    setErr(''); setBusy(true);
    try {
      const r = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The trips this browser is holding travel with them, so signing in
        // after a week of anonymous planning is not starting over.
        body: JSON.stringify({ email: email.trim(), phone: isUp ? phone.trim() : '', trips }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Could not open your account.'); setBusy(false); return; }
      onSignedIn(d);
      setEmail(''); setPhone(''); setBusy(false);
      onClose();
    } catch (e) {
      setErr('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  };

  // The <style jsx> below is a direct child of THIS element, not of .panel.
  //
  // Third time today: styled-jsx scopes narrowly, and with the block nested
  // inside .panel the root .scrim got no scoping class at all — so it had
  // none of its own rules, collapsed to the size of the sheet, and left the
  // page behind it live. On a fresh session that page is the onboarding form,
  // which is exactly the screen someone signs up from. It looked completely
  // fine in a screenshot; only clicking outside the sheet found it.
  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (required) return;
        if (!panel.current || !panel.current.contains(e.target)) onClose();
      }}
    >
      <div className="panel" ref={panel} role="dialog" aria-modal="true" aria-label={isUp ? 'Create your account' : 'Sign in'}>
        {!required && (
          <button className="x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}

        <div className={'tabs' + (required ? ' wide' : '')} role="tablist">
          <button role="tab" aria-selected={isUp} className={isUp ? 'on' : ''}
            onClick={() => { setTab('signup'); setErr(''); }}>Create account</button>
          <button role="tab" aria-selected={!isUp} className={!isUp ? 'on' : ''}
            onClick={() => { setTab('signin'); setErr(''); }}>Sign in</button>
        </div>

        <h2>{isUp ? (required ? 'Your email, and we start' : 'Keep your trips') : 'Welcome back'}</h2>
        <p className="lede">
          {isUp
            ? 'One email, and that is your account. No password to invent and no code to wait for.'
            : 'Enter the email you used. Your trips will be here.'}
        </p>

        <label htmlFor="au-email">Email</label>
        <input
          id="au-email" ref={field} type="email" inputMode="email" autoComplete="email"
          value={email} placeholder="you@example.com" disabled={busy}
          onChange={(e) => { setEmail(e.target.value); if (err) setErr(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        />

        {/* Only on the way in. Asking a returning traveller for a phone number
            they already gave is friction for nothing. */}
        {isUp && (
          <>
            <label htmlFor="au-phone">Phone <span className="opt">optional</span></label>
            <input
              id="au-phone" type="tel" inputMode="tel" autoComplete="tel"
              value={phone} placeholder="+60 12 345 6789" disabled={busy}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
            />
          </>
        )}

        {err && <p className="err" role="alert">{err}</p>}

        <button className="go" disabled={!ok || busy} onClick={go}>
          {busy ? 'One moment…' : isUp ? 'Create my account' : 'Sign in'}
        </button>

        <p className="foot">
          {isUp ? (
            <>Already have one? <button className="link" onClick={() => { setTab('signin'); setErr(''); }}>Sign in</button></>
          ) : (
            <>New here? <button className="link" onClick={() => { setTab('signup'); setErr(''); }}>Create an account</button></>
          )}
        </p>
        <p className="tiny">
          {required
            ? 'We need it to keep your trip and to know whose credits are whose. Nothing else is sent to you.'
            /* Where it is optional, anonymous is a real state and not a lapsed
               one — so nobody is nagged. */
            : 'You can carry on without an account — your trips just stay on this device.'}
        </p>

      </div>

      <style jsx>{`
        .scrim{
          position:fixed;inset:0;z-index:80;background:rgba(12,36,27,.42);
          display:flex;align-items:center;justify-content:center;padding:18px;
          animation:fade 180ms ease both;
        }
        .panel{
          position:relative;width:100%;max-width:380px;background:var(--surface);
          border-radius:22px;padding:22px 20px 18px;box-shadow:var(--sh-l);
          animation:rise 260ms cubic-bezier(.23,1,.32,1) both;
          max-height:calc(100dvh - 36px);overflow:auto;
        }
        .x{
          position:absolute;top:12px;right:12px;width:32px;height:32px;padding:0;
          display:flex;align-items:center;justify-content:center;
          border:0;border-radius:50%;background:var(--well);color:var(--ink-soft);cursor:pointer;
        }
        .x svg{width:15px;height:15px}
        .tabs{display:flex;gap:4px;background:var(--well);border-radius:12px;padding:4px;margin:2px 34px 16px 0}
        .tabs button{
          flex:1;border:0;background:transparent;border-radius:9px;padding:8px 6px;
          font-family:inherit;font-size:12.5px;font-weight:700;color:var(--ink-faint);cursor:pointer;
          transition:background 160ms ease,color 160ms ease;
        }
        .tabs button.on{background:var(--surface);color:var(--deep);box-shadow:var(--sh-s)}
        h2{margin:0 0 5px;font-size:20px;font-weight:800;letter-spacing:-.01em;color:var(--ink)}
        .lede{margin:0 0 16px;font-size:12.5px;line-height:1.5;color:var(--ink-faint)}
        label{display:block;font-size:11px;font-weight:700;color:var(--ink-soft);margin:0 0 5px}
        .opt{font-weight:600;color:var(--ink-faint);text-transform:none}
        input{
          width:100%;box-sizing:border-box;border:1.5px solid var(--line);border-radius:12px;
          padding:11px 13px;font-family:inherit;font-size:15px;color:var(--ink);
          background:var(--surface);margin:0 0 13px;
        }
        input:focus{outline:none;border-color:var(--deep)}
        input:disabled{opacity:.6}
        .err{
          margin:0 0 12px;font-size:12.5px;line-height:1.45;color:#8A3520;
          background:#FBEDE7;border-radius:10px;padding:9px 11px;
        }
        .go{
          width:100%;border:0;border-radius:99px;padding:13px;cursor:pointer;
          background:var(--deep);color:#EAF2EC;font-family:inherit;font-size:14px;font-weight:750;
        }
        .go:disabled{opacity:.45;cursor:default}
        .foot{margin:14px 0 0;text-align:center;font-size:12.5px;color:var(--ink-faint)}
        .link{
          border:0;background:none;padding:0;font-family:inherit;font-size:12.5px;
          font-weight:750;color:var(--deep);cursor:pointer;text-decoration:underline;
        }
        .tiny{margin:9px 0 0;text-align:center;font-size:11px;line-height:1.45;color:var(--ink-faint)}
        @keyframes fade{from{opacity:0}to{opacity:1}}
        @keyframes rise{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}
        /* On a phone it comes up from the bottom, which is where a thumb is. */
        @media (max-width:520px){
          .scrim{align-items:flex-end;padding:0}
          .panel{
            max-width:none;border-radius:22px 22px 0 0;padding-bottom:26px;
            max-height:88dvh;animation:sheet 280ms cubic-bezier(.23,1,.32,1) both;
          }
        }
        @keyframes sheet{from{transform:translateY(100%)}to{transform:none}}
        @media (prefers-reduced-motion:reduce){
          .scrim,.panel{animation-duration:1ms}
        }
      `}</style>
    </div>
  );
}
