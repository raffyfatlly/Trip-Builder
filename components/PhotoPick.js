import { useRef, useState } from 'react';

// Choosing a photo by hand.
//
// Two ways in, because they are the two things people actually have: a picture
// on their phone, and a link they found. (raffy, 2026-08-31: "make sure the
// photos can be edited (uploaded or direct url)".)
//
// An upload becomes a data URI rather than a hosted file, which sounds wasteful
// and is exactly right here: the downloaded itinerary is a single HTML file
// people take on a plane, and a data URI travels inside it. A hosted URL would
// be a photo that vanishes the moment they are offline — which is when they are
// most likely to be looking at it.
//
// So the image is resized before it is stored. A phone photo is 4MB and the
// card it lands in is a few hundred pixels wide; storing the original would
// blow the browser's storage quota after three pictures.

const MAX_EDGE = 1400;
const TARGET_BYTES = 320 * 1024;

// Draw it down to something sensible, then step the quality down until it fits.
function shrink(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image I can read.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);

        let q = 0.82;
        let out = canvas.toDataURL('image/jpeg', q);
        while (out.length * 0.75 > TARGET_BYTES && q > 0.4) {
          q -= 0.12;
          out = canvas.toDataURL('image/jpeg', q);
        }
        resolve(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Does this URL actually load as an image, in this browser, right now? Cheaper
// and more honest than any server-side check: if it renders here it will render
// in the preview, and if it does not the traveller finds out immediately
// instead of seeing a hole in their itinerary later.
function urlLoads(url) {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.referrerPolicy = 'no-referrer';
    img.src = url;
    setTimeout(() => finish(false), 8000);
  });
}

export default function PhotoPick({ current, onSet, onClear }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [credit, setCredit] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const upload = async (e) => {
    const file = (e.target.files || [])[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setBusy(true);
    try {
      onSet(await shrink(file), credit.trim());
      setOpen(false); setCredit('');
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  };

  const useUrl = async () => {
    const clean = url.trim();
    if (!/^https:\/\//i.test(clean)) { setErr('Needs to start with https://'); return; }
    setErr(''); setBusy(true);
    if (await urlLoads(clean)) {
      onSet(clean, credit.trim());
      setOpen(false); setUrl(''); setCredit('');
    } else {
      setErr('That link did not load as an image. Some sites block being linked to directly — try opening the image itself and copying that address.');
    }
    setBusy(false);
  };

  return (
    <div className="pp">
      <div className="ppbar">
        {current
          ? <img className="thumb" src={current} alt="" />
          : <span className="thumb none" />}
        <button className="ppbtn" onClick={() => { setOpen((v) => !v); setErr(''); }}>
          {current ? 'Change photo' : 'Add photo'}
        </button>
        {current && <button className="pprem" onClick={onClear}>Remove</button>}
      </div>

      {open && (
        <div className="ppbody">
          <button className="up" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Working…' : 'Upload from this device'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={upload} />

          <div className="or"><span>or paste a link</span></div>

          <input
            className="ppin" value={url} placeholder="https://…/photo.jpg"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') useUrl(); }}
          />
          <input
            className="ppin" value={credit} placeholder="Caption — what and where it is"
            onChange={(e) => setCredit(e.target.value)}
          />
          {err && <p className="pperr">{err}</p>}
          <div className="pprow">
            <button className="ppghost" onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
            <button className="ppgo" disabled={!url.trim() || busy} onClick={useUrl}>
              {busy ? 'Checking…' : 'Use this link'}
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .pp{margin-top:8px}
        .ppbar{display:flex;align-items:center;gap:9px}
        .thumb{
          width:38px;height:38px;border-radius:10px;object-fit:cover;flex:none;
          background:var(--sage);
        }
        .thumb.none{
          background:linear-gradient(160deg,var(--sage),#D5E2D2);
        }
        .ppbtn,.pprem{
          border:0;border-radius:99px;padding:8px 13px;font-size:12.5px;font-weight:650;
          cursor:pointer;font-family:inherit;background:var(--sage);color:var(--ink-soft);
        }
        .pprem{background:none;color:var(--ink-faint)}
        .pprem:hover{background:var(--sage)}

        .ppbody{
          margin-top:9px;background:var(--bg);border-radius:13px;padding:11px;
        }
        .up{
          width:100%;border:0;border-radius:11px;padding:11px;font-size:13px;font-weight:650;
          cursor:pointer;font-family:inherit;background:var(--deep);color:#EAF2EC;
        }
        .up:disabled{opacity:.5;cursor:default}
        .or{
          display:flex;align-items:center;gap:9px;margin:11px 0;
          font-size:11.5px;color:var(--ink-faint);
        }
        .or::before,.or::after{content:'';flex:1;height:1px;background:var(--line)}
        .ppin{
          width:100%;border:0;background:var(--surface);border-radius:11px;
          padding:10px 11px;font-size:14px;font-family:inherit;color:var(--ink);
          outline:none;margin-bottom:7px;
        }
        .ppin:focus{box-shadow:0 0 0 2px var(--deep)}
        .pperr{margin:2px 0 8px;font-size:12px;line-height:1.45;color:#8C3B14}
        .pprow{display:flex;gap:7px}
        .pprow button{
          border:0;border-radius:99px;padding:9px 14px;font-size:12.5px;font-weight:650;
          cursor:pointer;font-family:inherit;
        }
        .ppghost{background:var(--sage);color:var(--ink-soft)}
        .ppgo{flex:1;background:var(--deep);color:#EAF2EC}
        .ppgo:disabled{opacity:.45;cursor:default}
      `}</style>
    </div>
  );
}
