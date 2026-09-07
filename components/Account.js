import { useEffect } from 'react';

// Who you are, in the drawer.
//
// The form that used to live here has moved into components/Auth.js as a
// proper dialog (raffy, 2026-09-06: "proper sign-up and sign-in pop-ups and
// buttons"). This is now the account ROW: the signed-in identity, or the two
// buttons that open that dialog on the right tab. One implementation of the
// form, reached from the header and from here.
//
// Anonymous is a real state here, not a lapsed one. Someone who never signs in
// loses nothing they had before; they simply cannot reach their trips from a
// different phone, and the copy says exactly that rather than nagging.

export default function Account({ user, onOpenAuth, onSignOut, startOpen }) {
  // Arrived here from the "save your trips" nudge, which is a request to sign
  // in — so open the dialog rather than making them find the button again.
  useEffect(() => { if (startOpen && !user) onOpenAuth('signup'); }, [startOpen, user, onOpenAuth]);

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
      <p className="why">Your trips live on this device only. An account lets you open them anywhere.</p>
      <div className="pair">
        <button className="cta" onClick={() => onOpenAuth('signup')}>Create an account</button>
        <button className="alt" onClick={() => onOpenAuth('signin')}>Sign in</button>
      </div>
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
  .acct{margin-top:6px}
  .acct .why{
    margin:0 0 10px;font-size:12px;line-height:1.5;color:var(--ink-faint);
  }
  .acct .pair{display:flex;gap:8px}
  .acct .cta{
    flex:1;border:0;border-radius:99px;padding:11px 10px;cursor:pointer;
    background:var(--deep);color:#EAF2EC;
    font-family:inherit;font-size:13px;font-weight:750;
  }
  .acct .alt{
    flex:1;border:1.5px solid var(--line);border-radius:99px;padding:11px 10px;cursor:pointer;
    background:var(--surface);color:var(--deep);
    font-family:inherit;font-size:13px;font-weight:750;
  }
  .acct .cta:active{transform:scale(.985)}
  .acct .cta svg{width:17px;height:17px;flex:none;color:var(--deep)}
  .acct .cta span{display:flex;flex-direction:column;gap:2px;min-width:0}
  .acct .cta b{font-size:13px;font-weight:650}
  .acct .cta i{font-style:normal;font-size:11.5px;color:var(--ink-soft)}

  .acct .form{background:var(--well);border-radius:12px;padding:12px}
  .acct label{
    display:block;font-size:11px;font-weight:750;letter-spacing:.06em;
    text-transform:uppercase;color:var(--ink-faint);margin:0 0 5px;
  }
  .acct label + input{margin-bottom:11px}
  .acct .opt{text-transform:none;letter-spacing:0;font-weight:600;opacity:.75}
  .acct input{
    width:100%;border:0;background:var(--surface);border-radius:11px;padding:11px 12px;
    font-size:15px;font-family:inherit;color:var(--ink);outline:none;
  }
  .acct input:focus{box-shadow:0 0 0 2px var(--deep)}
  .acct .note{margin:2px 0 11px;font-size:11.5px;line-height:1.45;color:var(--ink-faint)}
  .acct .err{margin:0 0 10px;font-size:12.5px;line-height:1.4;color:#8C3B14}
  .acct .row{display:flex;gap:7px}
  .acct .row button{
    border:0;border-radius:99px;padding:10px 14px;font-size:13px;font-weight:650;
    cursor:pointer;font-family:inherit;
  }
  .acct .ghost{background:var(--sage);color:var(--ink-soft)}
  .acct .go{flex:1;background:var(--deep);color:#EAF2EC}
  .acct .go:disabled{opacity:.45;cursor:default}

  .acct.in{display:flex;align-items:center;gap:10px;background:var(--well);
      border-radius:12px;padding:10px 12px}
  .acct .who{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
  .acct .av{
    flex:none;width:28px;height:28px;border-radius:99px;background:var(--deep);
    color:#EAF2EC;display:grid;place-items:center;font-weight:700;font-size:12.5px;
  }
  .acct .det{display:flex;flex-direction:column;gap:2px;min-width:0}
  .acct .det b{font-size:12.5px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .acct .det i{font-style:normal;font-size:11px;color:var(--ink-soft)}
  .acct .out{
    flex:none;border:0;background:none;color:var(--ink-soft);font-size:12px;
    font-weight:650;cursor:pointer;padding:6px 8px;border-radius:9px;
  }
  .acct .out:hover{background:var(--sage)}
`;
