import { OUTFIT, JAKARTA, FACE } from './fonts.js';
import { checklist, dueIn, linkFor } from '../lib/checklist.js';

// The renderer. Turns one itinerary.json into a finished app.
//
// Environment-agnostic on purpose: it takes the template as a string and
// returns a string, so the exact same code runs in the Node CLI
// (tools/itinerary-generator/build.js) and in the browser, where the chat app
// renders the live preview and the download without any server work.
//
// Every replacement is asserted INDIVIDUALLY. A batch assert lets a silently
// failed replacement through, which has bitten this codebase twice: the ideas
// CSS that never inserted because an anchor comment had six more dashes than
// the script expected, and a shell replacement that shifted every line number
// beneath it.

export function render(T, templateSrc) {
  // The arranging phase, computed here so the app ships with it. Every task
  // carries its own deadline and the link that finishes it.
  const LIST = checklist(T);
  let lines = templateSrc.split('\n');
  let applied = 0;

  const fail = (m) => { throw new Error('build: ' + m); };

  // For values interpolated into the HTML head at build time.
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // --- helpers ---------------------------------------------------------------

  // Replace an inclusive 1-indexed line range. Verifies the range still looks
  // like what we expect before touching it, so a template change fails loudly
  // rather than producing a subtly wrong page.
  function replaceRange(a, b, expect, next, label) {
    const cur = lines.slice(a - 1, b).join('\n');
    if (!cur.includes(expect)) {
      fail(label + ': lines ' + a + '-' + b + ' no longer contain ' + JSON.stringify(expect));
    }
    lines = [...lines.slice(0, a - 1), next, ...lines.slice(b)];
    applied++;
  }

  // For statements that span lines, where an exact-string match is unwieldy.
  function replaceRegex(re, next, label) {
    const src = lines.join('\n');
    const m = src.match(re);
    if (!m) fail(label + ': pattern did not match');
    if (src.match(new RegExp(re.source, re.flags + 'g')).length !== 1) {
      fail(label + ': pattern matched more than once');
    }
    lines = src.replace(re, next).split('\n');
    applied++;
  }

  function replaceOnce(find, next, label) {
    const src = lines.join('\n');
    const n = src.split(find).length - 1;
    if (n !== 1) fail(label + ': expected exactly 1 match, found ' + n);
    lines = src.replace(find, next).split('\n');
    applied++;
  }

  // Lift the shell icons straight out of the template rather than retyping them.
  const svgsIn = (a, b) => lines.slice(a - 1, b).join('\n').match(/<svg[\s\S]*?<\/svg>/g) || [];

  const heroIcons = svgsIn(517, 521);
  const featIcons = svgsIn(541, 545);
  const planeIcon = svgsIn(556, 574)[0];
  if (heroIcons.length !== 3) fail('expected 3 hero chip icons, got ' + heroIcons.length);
  if (featIcons.length !== 3) fail('expected 3 feature stat icons, got ' + featIcons.length);
  if (!planeIcon) fail('could not lift the plane icon from the flights block');

  const footIcons = svgsIn(578, 580);
  if (footIcons.length !== 3) fail('expected 3 foot card icons, got ' + footIcons.length);

  const ICONS = {
    cal: heroIcons[0], pin: heroIcons[1], route: heroIcons[2],
    clock: featIcons[0], arrow: featIcons[1], hotel: featIcons[2],
    plane: planeIcon,
    warn: footIcons[0], info: footIcons[1],
  };

  // --- every line-range replacement runs strictly bottom-up ------------------
  // Line numbers below a replacement shift the moment one is applied, so the
  // whole file is walked from the highest line to the lowest. Doing the shell
  // blocks (506-574) before the data arrays (746-947) silently invalidates every
  // range beneath them.

  // data: swap the inlined arrays for references into T
  replaceRange(873, 947, 'var DAYS=[', '  var DAYS=T.days;', 'DAYS array');
  replaceRange(864, 868, 'var AREAS', '  var AREAS=T.areas;', 'AREAS array');
  replaceRange(804, 862, 'var IDEAS', '  var IDEAS=T.ideas;', 'IDEAS array');
  replaceRange(753, 782, 'var STAYS=[', '  var STAYS=T.stays;', 'STAYS array');
  replaceRange(746, 750, 'var P = {', '  var P=T.photos;', 'photo map');

  // The illustrated map is Phu Quoc's and does not generalise: an OSM polygon
  // simplified to 168 points, a computed centreline so the route follows land,
  // and markers displaced offshore by hand because the tap targets collided.
  // There is no honest way to auto-generate that for an arbitrary destination,
  // so a trip without map data loses the section entirely (the nav button is
  // hidden further down).
  // Only the illustrated header and the SVG go. The "In order" stay list and
  // the Ideas list live in this same section and are real content — the AI
  // generates ideas for every trip — so the section survives and becomes the
  // Ideas tab instead. Removing the whole section would also null out the
  // `ordered` and `ideas` containers the renderer appends into.
  if (!T.map) {
    replaceRange(589, 685, 'Where you go',
      '    <div style="padding:calc(14px + env(safe-area-inset-top)) 0 16px">\n' +
      '      <span class="eyebrow">Worth doing</span>\n' +
      '      <h1 style="font-size:34px;font-weight:700;margin-top:8px">Explore</h1>\n' +
      '    </div>',
      'strip illustrated map');
  }

  // "Before you lock this in" — three caveat cards plus a credits line, all
  // hardcoded about Phu Quoc ("Stop 4 is not booked", "La Festa in Sunset
  // Town"). Real content, wrong trip: it becomes data-driven from trip.notes.
  replaceRange(576, 584, 'Before you lock this in',
    '    <div class="foot" id="foot"></div>', 'foot section');

  // shell: replace the hardcoded blocks with containers renderShell() fills
  replaceRange(556, 574,
    'flightcard',
    '    <div class="card" id="flights"></div>',
    'flights card');

  replaceRange(534, 547,
    'class="feature"',
    '    <div class="feature" id="feature"></div>',
    'feature card');

  replaceRange(514, 532,
    'class="crew"',
    '    <div class="hero" id="hero"></div>',
    'hero block');

  replaceRange(506, 512,
    'class="hello"',
    '    <div class="hello" id="hello"></div>',
    'hello block');

  // --- inject the data object + shell renderer -------------------------------

  const SHELL = `
    var T = ${JSON.stringify(T)};
    // Derived at build time from the plan and the filed bookings — see
    // lib/checklist.js. Each entry already knows when it has to happen and
    // where it gets done.
    var TODO = ${JSON.stringify({
      todo: LIST.todo.map((t) => ({ ...t, due: dueIn(t.by), link: linkFor(t, T) })),
      done: LIST.done.map((t) => ({ ...t, link: linkFor(t, T) })),
      extra: LIST.extra,
    })};
    var SHELLI = ${JSON.stringify(ICONS)};

    // chip()/lnk() used to be called at data-definition time and returned HTML.
    // Chips are declarative now, so they get rendered here instead.
    function renderChip(c){
      if(!c) return '';
      if(typeof c === 'string') return c;                 // tolerate legacy
      if(c.kind === 'link') return lnk(c.label, c.href);
      return chip(c.text);
    }
    // Credit lines carried the CC licence link by string concatenation. The
    // licence is its own field now, so the renderer re-attaches it.
    function creditOf(o){
      if(!o || !o.credit) return '';
      return o.licence
        ? o.credit + ', <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">' + o.licence + '</a>'
        : o.credit;
    }
    function pill(icon, text){
      return '<span class="pill tiny">' + (SHELLI[icon]||'') + esc(text) + '</span>';
    }
    // Derived, not stored — the agent fills travellers and this follows, so the
    // two can never disagree.
    function crewCaption(){
      if(T.trip.crewCaption) return T.trip.crewCaption;
      var n = (T.trip.travellers||[]).map(function(p){ return p.name; });
      if(!n.length) return '';
      if(n.length === 1) return n[0];
      return n.slice(0,-1).join(', ') + ' and ' + n[n.length-1];
    }
    var MO=['January','February','March','April','May','June','July',
            'August','September','October','November','December'];
    // Short month for day index di, walked forward from the trip start so a
    // trip that spans a month boundary still labels each day correctly.
    function monthOf(di){
      var d=new Date(T.trip.start+'T00:00:00');
      if(isNaN(d)) return '';
      d.setDate(d.getDate()+di);
      return MO[d.getMonth()].slice(0,3);
    }
    // "15 to 24 August 2026" from the trip's ISO start/end dates.
    function dateRange(){
      var a=new Date(T.trip.start+'T00:00:00'), b=new Date(T.trip.end+'T00:00:00');
      if(isNaN(a)||isNaN(b)) return T.trip.titleSub||'';
      var sameMonth = a.getMonth()===b.getMonth() && a.getFullYear()===b.getFullYear();
      return a.getDate() + (sameMonth ? '' : ' ' + MO[a.getMonth()]) +
        ' to ' + b.getDate() + ' ' + MO[b.getMonth()] + ' ' + b.getFullYear();
    }


    // A remote photo can 404, be blocked, or have its URL rotate. Rather than
    // an onerror attribute on every img — which has to survive three layers of
    // string quoting and broke the page when it did not — one capture-phase
    // listener handles every image, including ones rendered later.
    document.addEventListener('error', function(e){
      var img = e.target;
      if(!img || img.tagName !== 'IMG') return;
      var fig = img.closest && img.closest('figure.evshot');
      if(fig){ fig.remove(); return; }                       // drop the whole figure
      var card = img.closest && img.closest('.staycard');
      if(card){ img.outerHTML = '<div class="ph"></div>'; return; }   // gradient instead
      var feat = img.closest && img.closest('.feature');
      if(feat){
        img.remove();
        feat.className = 'feature nophoto';
        var v = feat.querySelector('.veil');
        if(v) v.remove();
        return;
      }
      img.remove();
    }, true);

    // Booking status written as prose.
    //
    // The app already shows whether a stay is booked, from the stay's own
    // draft flag, and that updates the moment someone confirms. But the
    // builder ALSO writes the same fact into free text — a "Not booked yet"
    // tag on the check-in, a caveat in the notes — and that text has no idea
    // the booking has since been made. Confirming used to clear the badge and
    // leave three sentences behind still calling it a guess.
    //
    // The builder is told not to do this any more. This heals the trips that
    // already exist: a phrase list narrow enough to only catch booking status,
    // applied only where the stay it refers to is confirmed.
    // Not every trip is a flight. A countdown that says "until you fly" to
    // someone driving to Johor Bahru is a small lie the whole app is judged
    // by. (raffy, 2026-08-31: "the countdown hardcoded fly. but some trips are
    // by car right".)
    // Never a blank card, booked or not. (raffy, 2026-09-01: "make sure even
    // the hotel not book. the photo need to be there. so it looks nice.
    // that's why the app is special. it looks nice.")
    //
    // Every stay carries its own lat/lon, so when there is no photograph we
    // can still show the actual place: a map tile centred on that hotel. It
    // is honest — this really is where they would be sleeping — and it means
    // an unbooked option looks like a considered suggestion instead of an
    // empty slot. This runs in the app rather than in the builder because the
    // builder forgetting is exactly how cards ended up blank.
    function mapTile(o, zoom){
      if(!o) return '';
      var la = Number(o.lat), lo = Number(o.lon);
      if(!isFinite(la) || !isFinite(lo)) return '';
      return 'https://maps.wikimedia.org/img/osm-intl,' + (zoom||15) + ',' +
        la.toFixed(4) + ',' + lo.toFixed(4) + ',640x360.png';
    }
    function shotFor(o, zoom){
      if(o && o.photo && P[o.photo]) return P[o.photo];
      return mapTile(o, zoom);
    }

    function leaveVerb(){
      return (T.trip.flights && T.trip.flights.length) ? 'fly' : 'set off';
    }
    function leaveToday(){
      return (T.trip.flights && T.trip.flights.length) ? 'You fly today' : 'You leave today';
    }

    // \\b, not \b: this lives inside a template literal, where \b is a
    // backspace character rather than a word boundary. It silently compiled
    // to a regex that could never match anything.
    var STALE = /\\b(not booked|not confirmed|unconfirmed|still deciding|to be confirmed|provisional)\\b/i;
    function anyDraft(){
      return (T.stays || []).some(function(x){ return x.draft; });
    }
    function staleTag(t, stayIdx){
      if(!STALE.test(String(t))) return false;
      var st = T.stays && T.stays[stayIdx];
      return st ? !st.draft : !anyDraft();
    }

    function renderShell(){
      var tr = T.trip, el;

      el = document.getElementById('hello');
      if(el) el.innerHTML =
        '<div><div class="who">Hi ' + esc(tr.who) + ' \\uD83D\\uDC4B</div>' +
        '<div class="sub" id="countdown">' + esc(tr.sub) + '</div></div>' +
        '<span class="pill tiny" id="tripstate">' + esc(tr.statePill) + '</span>';

      el = document.getElementById('hero');
      if(el) el.innerHTML =
        '<span class="pill tiny ghost">' + esc(tr.flag) + '</span>' +
        '<h1 style="margin-top:14px">' + esc(tr.title) +
          '<span class="h2">' + esc(tr.titleSub) + '</span></h1>' +
        '<div class="herochips">' +
          (tr.heroChips||[]).map(function(c){ return pill(c.icon, c.text); }).join('') +
        '</div>' +
        '<div class="crew"><div class="faces">' +
          (tr.travellers||[]).map(function(p){
            return '<span style="background:' + esc(p.color) + '">' + esc(p.initial) + '</span>';
          }).join('') +
        '</div><span class="cap">' + esc(crewCaption()) + '</span></div>';

      el = document.getElementById('feature');
      var f = tr.feature;
      if(el && f){
        // A generated trip usually has no photos at all. An <img> with an empty
        // src renders as a broken-image icon, and .fc is absolutely positioned
        // over the image — with no image the card collapses and the text spills
        // out. So drop the img entirely and let CSS restack the card.
        // The feature card has no coordinates of its own, so it borrows the
        // first stay's — a wider map of the area they are going to.
        var fsrc = shotFor(f) || mapTile((T.stays||[])[0], 12);
        // The veil exists to make text readable over a photograph. With no
        // text it is just a photograph made darker for no reason, so the card
        // shows the picture clean instead. (The builder is told to always
        // write the copy; this is what it looks like when it does not.)
        var hasCopy = !!(f.h || f.p || (f.stats||[]).length);
        el.className = 'feature' + (fsrc ? '' : ' nophoto');
        el.innerHTML =
          (fsrc ? '<img src="' + esc(fsrc) + '" alt="' + esc(f.alt||'') + '" />' + (hasCopy ? '<div class="veil"></div>' : '') : '') +
          '<span class="pill tiny badge coral" id="febadge"></span>' +
          '<div class="fc">' + (f.h ? '<h2>' + esc(f.h) + '</h2>' : '') +
          (f.p ? '<p>' + esc(f.p) + '</p>' : '') +
          '<div class="fstats">' +
            (f.stats||[]).map(function(s){ return pill(s.icon, s.text); }).join('') +
          '</div></div>';
      }

      // Hide the whole Flights block when there are none, rather than leaving an
      // empty white card. The traveller often does not have flight times yet.
      // Both halves have to go — the heading and the card are siblings.
      var hasFlights = !!(tr.flights && tr.flights.length);
      var fsect = document.getElementById('flights-sect');
      if(fsect) fsect.hidden = !hasFlights;
      var fcard = document.getElementById('flights');
      if(fcard) fcard.hidden = !hasFlights;

      el = document.getElementById('foot');
      // A note about a specific stay's booking is tagged with that stay's
      // index. Once it is confirmed the note is stale, so it is dropped here
      // rather than staying stuck on screen — this re-runs every time the
      // preview redraws, including right after "Confirm" in the editor.
      // "Before you lock this in" was a review screen for a review that no
      // longer happens here.
      //
      // raffy, 2026-09-01: "do u think that's the best position to place it
      // there ? or somewhere else ? or integrated as individual somewhere
      // else?" — the third one. The section was written when this app WAS the
      // proposal you approved. Accepting the trip moved into the chat
      // (propose_trip) long ago, so by the time this app exists the trip is
      // locked in, and a heading asking you to review it is describing a step
      // that already happened.
      //
      // What is left is two different things. A note about something unbooked
      // is a TASK — it now lives on To do with a deadline and a booking link,
      // and repeating it here undated is exactly the duplication that made the
      // Wallet unrecognisable. A note about something worth knowing is neither
      // a task nor a review: it is context, and it stays.
      var notes = (tr.notes || []).filter(function(n){
        // Anything pinned to a stay is that stay's booking task. To do owns it.
        if(n.stay != null) return false;
        // Untagged, from a trip built before notes carried a stay index: drop
        // it only once nothing is a draft any more, so it cannot hide a
        // caveat that is still true.
        return !(STALE.test(String(n.h) + ' ' + String(n.p)) && !anyDraft());
      });
      if(el){
        el.hidden = !notes.length && !tr.credits;
        el.innerHTML =
          // Folded away by default. raffy, 2026-09-01: "the worth knowing part ,
          // should be in collapsed mode so it doesn't take too much space of the
          // trip page." It is context, not a task — true all trip, needed once.
          // A <details> is the right control here and it costs nothing: it works
          // with no JavaScript, it is keyboard and screen-reader native, and it
          // survives being downloaded and opened offline.
          (notes.length
            ? '<details class="wk"><summary><h2>Worth knowing</h2>' +
              '<span class="wkn">' + notes.length + '</span>' +
              '<svg class="wkc" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
              'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="m6 9 6 6 6-6"/></svg></summary><div class="wkb">' +
              notes.map(function(n){
                return '<div class="card">' + (SHELLI[n.kind === 'warn' ? 'warn' : 'info'] || '') +
                  '<div><b>' + esc(n.h || '') + '</b> ' + esc(n.p || '') + '</div></div>';
              }).join('') +
              '</div></details>'
            : '') +
          (tr.credits ? '<div class="credits">' + esc(tr.credits) + '</div>' : '');
      }

      el = document.getElementById('flights');
      if(el) el.innerHTML = (tr.flights||[]).map(function(fl, i){
        return (i ? '<div class="fdiv"></div>' : '') +
          '<div class="flightcard">' +
            '<div class="col"><div class="code">' + esc(fl.from) + '</div>' +
              '<div class="t">' + esc(fl.dep) + '</div></div>' +
            '<div class="mid">' + SHELLI.plane +
              '<span class="d">' + esc(fl.day) + '</span></div>' +
            '<div class="col r"><div class="code">' + esc(fl.to) + '</div>' +
              '<div class="t">' + esc(fl.arr) + '</div></div>' +
          '</div>';
      }).join('');
    }
  `;

  replaceOnce('  var I = {', SHELL + '\n  var I = {', 'inject data + shell renderer');

  // --- rewire the renderer to the declarative shapes -------------------------

  replaceOnce(
    'if(r.it.chips) r.it.chips.forEach(function(c){ bits.push(c); });',
    'if(r.it.chips) r.it.chips.forEach(function(c){ bits.push(renderChip(c)); });',
    'chip rendering');

  replaceOnce(
    "<figcaption class=\"cr\">'+r.it.credit+'</figcaption>",
    "<figcaption class=\"cr\">'+creditOf(r.it)+'</figcaption>",
    'item photo credit');


  // --- trip-scoped constants -------------------------------------------------

  replaceOnce('var PQ_OFF=7*60;', 'var PQ_OFF=T.trip.tzOffsetMin;', 'timezone offset');
  replaceOnce("var LSK='pq26.v1'", "var LSK=T.trip.id+'.v1'", 'localStorage key');

  // The clock badge and the trip-complete card both name the destination.
  replaceOnce(
    "<div class=\"z\">Phu Quoc</div>",
    "<div class=\"z\">'+esc(T.trip.title)+'</div>",
    'clock timezone label');

  replaceOnce(
    "'<div class=\"lsub\">Phu Quoc, 15 to 24 August 2026. The days are all still here.</div>'",
    "'<div class=\"lsub\">'+esc(T.trip.title)+', '+esc(dateRange())+'. The days are all still here.</div>'",
    'trip-complete subtitle');

  // --- no-photo fallbacks ----------------------------------------------------
  // The Phu Quoc app always has photos. A generated trip usually has none until
  // the traveller uploads some, and the layout assumes an image is there: .fc
  // and .badge are absolutely positioned over it, so without one the card
  // collapses to nothing and its text spills across the page.

  // Same problem on the stay carousel: P[s.photo] is undefined without a photo,
  // which becomes src="undefined" and renders a broken-image icon.
  replaceOnce(
    'b.innerHTML=\'<img src="\'+P[s.photo]+\'" alt=""><div class="veil"></div>\'+',
    'b.innerHTML=(function(){var q=shotFor(s);return q?\'<img src="\'+q+\'" alt=""><div class="veil"></div>\':\'<div class="ph"></div><div class="veil"></div>\';})()+',
    'stay card photo guard');

  replaceOnce('  .feature .badge{position:absolute;top:16px;left:16px}',
    '  .feature .badge{position:absolute;top:16px;left:16px}\n' +
    // With a photo AND long prose the card overflowed: .fc is anchored to the
  // bottom of a fixed 290px image, so taller content grew upwards over the
  // badge and off the top. Making the card a flex column with the image
  // absolutely behind it means it grows with its content instead. Short
  // content still sits at the bottom of a 290px box, so nothing changes for
  // a trip whose feature text is brief.
  '  .feature{display:flex;flex-direction:column;justify-content:flex-end;min-height:290px}\n' +
  '  .feature img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}\n' +
  '  .feature .veil{z-index:1}\n' +
  '  .feature .fc{position:relative;z-index:2;padding:54px 20px 20px}\n' +
  '  .feature .badge{z-index:3}\n' +
  '  .feature.nophoto{background:linear-gradient(160deg,var(--deep),#0C2A20);padding-top:18px;min-height:0}\n' +
    '  .feature.nophoto .fc{position:static;padding:16px 20px 20px}\n' +
    '  .feature.nophoto .badge{position:static;display:inline-flex;margin-left:20px}\n' +
    '  .staycard .ph{width:100%;height:100%;background:linear-gradient(160deg,var(--deep),#0C2A20)}\n' +
    // .sect is display:flex, which outranks the UA [hidden] rule, so the
    // Flights heading stayed visible with its card hidden beneath it.
    '  [hidden]{display:none!important}',
    'no-photo CSS');

  // --- live-state strings ----------------------------------------------------
  // renderLive() computes its text, so these leaks are invisible in the source
  // data and only surface once a different trip is rendered.

  replaceOnce('<div class="sect"><h2>Flights</h2></div>',
    '<div class="sect" id="flights-sect"><h2>Flights</h2></div>', 'wrap flights heading');

  replaceOnce("badge('15 to 24 Aug 2026');", 'badge(dateRange());', 'trip-complete badge');

  replaceOnce(
    "'<div class=\"lsub\">until you fly out of <b>Kuala Lumpur</b>. Nine nights, four hotels, two coasts.</div>'",
    "'<div class=\"lsub\">until you '+leaveVerb()+(T.trip.flights&&T.trip.flights[0]?' out of <b>'+esc(T.trip.flights[0].from)+'</b>':'')+'. '+esc(T.trip.titleSub||'')+', '+STAYS.length+(STAYS.length===1?' stay':' stays')+'.</div>'",
    'countdown subtitle');

  // Five separate places render the month as the literal "Aug". Each sits in a
  // different scope, so each needs its own day index — a blanket replace would
  // compile and then label every day of a September trip as August.
  replaceOnce("d.dom+' Aug &middot; '", "d.dom+' '+monthOf(di)+' &middot; '", 'live card month');
  replaceOnce("'<span class=\"pill tiny dark\">'+d.dow+' '+d.dom+' Aug</span>'",
    "'<span class=\"pill tiny dark\">'+d.dow+' '+d.dom+' '+monthOf(i)+'</span>'", 'day header month');
  replaceOnce("Add to '+d.dow+' '+d.dom+' Aug</button></div>'",
    "Add to '+d.dow+' '+d.dom+' '+monthOf(i)+'</button></div>'",
    'plan-add button month');
  replaceOnce("Jump to today, '+DAYS[di].dow+' '+DAYS[di].dom+' Aug</button>'",
    "Jump to today, '+DAYS[di].dow+' '+DAYS[di].dom+' '+monthOf(di)+'</button>'",
    'jump-to-today month');
  replaceOnce("'>'+dd.dow+' '+dd.dom+' Aug</option>'",
    "'>'+dd.dow+' '+dd.dom+' '+monthOf(k)+'</option>'", 'day picker month');

  // The day index — which decides before / during / after for the whole live
  // layer — was anchored to Phu Quoc's start date. A September trip therefore
  // rendered as "Trip complete". No string to catch this one; the leak was a
  // date literal, which is why it survived the guard.
  replaceOnce('Date.UTC(2026,7,15))/86400000);',
    "Date.parse(T.trip.start+'T00:00:00Z'))/86400000);",
    'trip day index anchor');

  // The countdown targeted a hardcoded UTC instant for the KUL departure.
  // Without the origin's timezone in the schema, the honest target is the start
  // of day one in destination time — never more than a few hours off, on a
  // countdown measured in days.
  replaceRegex(/var DEPART=Date\.UTC\(2026,7,15,4,50\);.*$/m,
    "var DEPART=T.trip.departUtc?Date.parse(T.trip.departUtc):(Date.parse(T.trip.start+'T00:00:00Z')-T.trip.tzOffsetMin*60000);",
    'departure instant');

  // A seasonal warning is exactly the kind of thing that makes an itinerary
  // good, and exactly the kind that cannot be reused: this one is about the
  // southwest monsoon in Phu Quoc. It becomes trip.seasonNote, omitted when the
  // agent has nothing worth saying.
  replaceRegex(
    /var h='<div class="note" style="margin-top:14px">'\+I\.info\+\s*\n\s*'<div><b>One thing about August\.[\s\S]*?<\/div><\/div>';/,
    "var h=!T.trip.seasonNote?'':'<div class=\"note\" style=\"margin-top:14px\">'+I.info+\n      '<div>'+esc(T.trip.seasonNote)+'</div></div>';",
    'season note');

  // A "Not booked yet" tag on the check-in is the same stale prose as the
  // notes: the app knows the booking status from the stay's own flag, so once
  // that flips the tag is simply wrong. Dropped here rather than left to
  // contradict the badge two lines above it.
  replaceOnce(
    "        if(r.it.tags) r.it.tags.forEach(function(t){",
    "        if(r.it.tags) r.it.tags.filter(function(t){ return !staleTag(t, DAYS[i].stay); }).forEach(function(t){",
    'stale booking tags');

  // Same for the countdown's own wording and the two badges beside it.
  replaceOnce(
    "      if(cd) cd.textContent=dd>0?(dd+(dd===1?' day':' days')+' until you fly'):'You fly today';",
    "      if(cd) cd.textContent=dd>0?(dd+(dd===1?' day':' days')+' until you '+leaveVerb()):leaveToday();",
    'countdown verb');
  replaceOnce(
    "      badge(dd>0?(dd+(dd===1?' day':' days')+' to go'):'You fly today');",
    "      badge(dd>0?(dd+(dd===1?' day':' days')+' to go'):leaveToday());",
    'countdown badge verb');

  // The draft-stay warning named La Festa outright. Use the stay's own name.
  replaceOnce(
    "'<div><b>This stay is not booked yet.</b> Everything from here assumes La Festa in Sunset Town. If you book elsewhere in the south most of this still holds.</div></div>'",
    "'<div><b>This stay is not booked yet.</b> Everything from here assumes '+esc(s.n)+'. If you book elsewhere nearby most of this still holds.</div></div>'",
    'draft stay note');

  // "Looked at, decided against" was three hardcoded paragraphs about Phu Quoc
  // that named Seth, Belle and Raes — so every generated trip carried a
  // stranger's children. It becomes trip.declined, and the box disappears
  // entirely when there is nothing to put in it, rather than showing an empty
  // heading on a trip where nothing was ruled out.
  replaceRegex(
    /h\+='<div class="skipbox"><h4>Looked at, decided against<\/h4>'\+[\s\S]*?cannot control this month\.<\/p><\/div>';/,
    "h+=!(T.trip.declined && T.trip.declined.length) ? '' :\n" +
    "       '<div class=\"skipbox\"><h4>Looked at, decided against</h4>'+\n" +
    "       T.trip.declined.map(function(d){\n" +
    "         return '<p><b>'+esc(d.h||'')+'</b> '+esc(d.p||'')+'</p>';\n" +
    "       }).join('')+'</div>';",
    'decided-against box');

  // --- tolerate optional fields ----------------------------------------------
  // The Phu Quoc data happens to populate `days` and `near` on all 8 ideas, so
  // the renderer dereferences them directly. A generated trip legitimately omits
  // them (they are optional in the schema), and an undefined .indexOf takes the
  // whole page down. Harmless for Phu Quoc, load-bearing for everything else.

  replaceOnce(
    'filter(function(o){return o.d.days.indexOf(i)>-1;})',
    'filter(function(o){return (o.d.days||[]).indexOf(i)>-1;})',
    'guard idea.days in day view');

  replaceOnce(
    'IDEAS.filter(function(x){ return x.days.indexOf(di)>-1; })',
    'IDEAS.filter(function(x){ return (x.days||[]).indexOf(di)>-1; })',
    'guard idea.days in live card');

  replaceOnce(
    'filter(function(o){return o.d.near.indexOf(idx)>-1;})',
    'filter(function(o){return (o.d.near||[]).indexOf(idx)>-1;})',
    'guard idea.near in stay sheet');

  // --- head ------------------------------------------------------------------

  replaceOnce(
    '<meta name="description" content="Phu Quoc family trip, 15 to 24 August 2026. Four stays, day by day." />',
    `<meta name="description" content="${esc(T.trip.title)} itinerary, day by day." />`,
    'meta description');

  replaceOnce(
    '<meta name="apple-mobile-web-app-title" content="Phu Quoc" />',
    `<meta name="apple-mobile-web-app-title" content="${esc(T.trip.title)}" />`,
    'apple web app title');

  replaceOnce(
    '<title>Phu Quoc, nine nights</title>',
    `<title>${esc(T.trip.title)}${T.trip.titleSub ? ', ' + esc(T.trip.titleSub) : ''}</title>`,
    'page title');

  // The section is edited earlier, in the bottom-up block, because it is a line
  // range. Here the tab keeps its slot but stops claiming to be a map.
  if (!T.map) {
    // raffy, 2026-09-01: "change ideas to explore". Explore is a verb — it says
    // what the tab is for rather than what it contains.
    replaceOnce('<span>Map</span>', '<span>Explore</span>', 'relabel map tab as Explore');
  }

  // Adding to the app, rather than doing surgery on it.
  //
  // Every helper above CHANGES something that is already there — find this
  // markup, swap it. That is hopeless for adding a whole section: there is no
  // Phu Quoc bookings tab to find and replace.
  //
  // So: insert at structural markers (</style>, </nav>, the tag that closes the
  // view stack) rather than at content. Those are the load-bearing bones of any
  // version of this template, unlike the prose the splices above match on.
  //
  // Everything here runs LAST, after every line-range replacement is done —
  // those still address absolute line numbers, and inserting a single line
  // above them silently shifts every block beneath. Late insertion sidesteps
  // that entirely rather than trying to make 47 splices position-independent.
  //
  // Decided 2026-09-01, over rebuilding the app as composed parts: composition
  // buys one property — cheap section-adding — for the price of dismantling
  // 117k characters of finished design and rewriting all 47 splices. This buys
  // the same property in an afternoon.
  function insertBefore(find, html, label) {
    const src = lines.join('\n');
    const n = src.split(find).length - 1;
    if (n !== 1) fail(label + ': marker ' + JSON.stringify(find) + ' found ' + n + ' times, expected 1');
    lines = src.replace(find, html + find).split('\n');
    applied++;
  }

  function insertAfter(find, html, label) {
    const src = lines.join('\n');
    const n = src.split(find).length - 1;
    if (n !== 1) fail(label + ': marker ' + JSON.stringify(find) + ' found ' + n + ' times, expected 1');
    lines = src.replace(find, find + html).split('\n');
    applied++;
  }


  // --- the Bookings tab ------------------------------------------------------
  //
  // raffy, 2026-09-01: "it misses the handling the booking part... we need app
  // that keep their flight bookings , hotel bookings etc. so they just open the
  // app and everything is kept nicely for them in there."
  //
  // Nothing new is stored yet. This re-presents what the trip already knows —
  // flights, stays, and which of them are still drafts — as the one place you
  // look on the morning you travel. It is the tab that has to work offline, at
  // a counter, at 6am.

  insertBefore('</style>', [
    '  .bk h2{font-size:23px;font-weight:700}',
    '  .bkhead{padding:calc(14px + env(safe-area-inset-top)) 0 4px}',
    '  .bksub{margin:9px 0 0;font-size:14.5px;color:var(--ink-soft);max-width:34ch}',
    '  .bkrow{display:flex;gap:13px;align-items:flex-start}',
    '  .bkicon{width:52px;height:52px;border-radius:15px;flex:none;display:grid;place-items:center;background:var(--sage);color:var(--deep)}',
    '  .bkicon svg{width:21px;height:21px}',
    '  .bkicon.soft{background:var(--wash,#F1EEE7);color:var(--ink-faint)}',
    '  .bkbody{flex:1;min-width:0}',
    '  .bkbody b{display:block;font-family:\'Outfit\',sans-serif;font-size:16.5px;font-weight:700;letter-spacing:-.01em;line-height:1.25}',
    '  .bkmeta{font-size:12.5px;color:var(--ink-faint);margin-top:3px;line-height:1.45}',
    '  .bktag{display:inline-flex;align-items:center;gap:5px;margin-top:8px;padding:4px 9px;border-radius:var(--r-pill);font-size:10.5px;font-weight:750;letter-spacing:.03em;text-transform:uppercase}',
    '  .bktag.ok{background:#DCEBE1;color:#155C3C}',
    '  .bktag.no{background:#FCE6D8;color:var(--coral-text)}',
    // The reference is the only thing on this screen with a job to do at a
    // counter, so it is the only thing you can press. Copy, not select-and-
    // fumble, at 6am with a bag on your shoulder.
    '  .bkref{display:flex;align-items:center;gap:10px;width:100%;margin-top:13px;padding:11px 0 0;border:0;border-top:1px solid var(--line);background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '  .bkref .k{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint)}',
    '  .bkref .v{font-family:\'Outfit\',sans-serif;font-size:16px;font-weight:700;letter-spacing:.04em;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '  .bkref .cp{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--deep);flex:none}',
    '  .bkref:active{opacity:.55}',
    '  .bkref.done .cp{color:#155C3C}',
    '  .bknote{margin-top:11px;padding:10px 12px;border-radius:12px;background:var(--sage);font-size:12.5px;line-height:1.5;color:var(--deep)}',
    '  .tdlead{margin:-4px 2px 10px;font-size:12.5px;color:var(--ink-faint)}',
    '  .tdcard{margin-bottom:9px}',
    // The deadline is the only thing on this screen that changes behaviour, so
    // it is the only thing that gets colour.
    '  .bkicon.hot{background:var(--coral);color:#3A1405}',
    '  .tdfoot{display:flex;align-items:center;gap:10px;margin-top:13px;',
    '    padding:11px 0 0;border-top:1px solid var(--line)}',
    // The arrow belongs to the words, not to the far side of the card.
    // raffy, 2026-09-01: "the button to open should be place right beside book
    // it for find flights or whatever." It was pushed to the opposite edge by
    // space-between, so it read as a separate control with nothing to do with
    // the label it was serving.
    '  .tdgo{display:inline-flex;align-items:center;gap:6px;flex:1;min-width:0;',
    '    font-size:13px;font-weight:700;color:var(--deep);text-decoration:none}',
    '  .tdgo svg{opacity:.65}',
    '  .tdtop{display:flex;align-items:flex-start;gap:10px}',
    '  .tdtop b{flex:1;min-width:0}',
    '  .tdtop .bktag{margin-top:1px;flex:none}',
    '  .tdm{display:flex;align-items:flex-start;gap:7px;margin-top:5px;',
    '    font-size:12.5px;line-height:1.45;color:var(--ink-faint)}',
    '  .tdm svg{width:13px;height:13px;flex:none;margin-top:2px;opacity:.8}',
    '  .tdm span{min-width:0}',
    '  .tdwhy{margin-top:7px;font-size:12.5px;line-height:1.45;color:var(--ink-soft)}',
    '  .tddone{display:inline-flex;align-items:center;gap:6px;flex:none;border:0;',
    '    background:var(--sage);color:var(--deep);border-radius:var(--r-pill);',
    '    padding:8px 13px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}',
    '  .tddone svg{width:14px;height:14px;flex:none}',
    '  .tddone:active{opacity:.6}',
    '  .tdx{flex:none;border:0;background:none;padding:6px;cursor:pointer;color:var(--ink-faint);',
    '    display:grid;place-items:center;order:9}',
    '  .tdx svg{width:15px;height:15px;display:block}',
    '  .tdx:active{opacity:.5}',
    '  .tdadd{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;',
    '    border:1.5px dashed var(--line);background:none;border-radius:var(--r-card);',
    '    padding:14px;font:inherit;font-size:13.5px;font-weight:650;color:var(--ink-soft);',
    '    cursor:pointer;margin-top:2px}',
    '  .tdadd svg{width:16px;height:16px;flex:none}',
    '  .tdadd:active{opacity:.6}',
    '  .tdgo svg{width:14px;height:14px;flex:none;opacity:.7}',
    '  .tdgo:active{opacity:.55}',
    // Not struck through: a booked thing is a record you still read, not a
    // line you cross out and stop caring about.
    '  .tdcard.is-done{background:var(--surface)}',
    '  .tdcard.is-done .bkicon.soft{background:#DCEBE1;color:#155C3C}',
    '  .bkempty{background:var(--surface);border-radius:var(--r-card);box-shadow:var(--sh-s);padding:22px 18px;text-align:center}',
    '  .bkempty .ico{width:44px;height:44px;border-radius:14px;background:var(--sage);color:var(--deep);display:grid;place-items:center;margin:0 auto 12px}',
    '  .bkempty .ico svg{width:20px;height:20px}',
    '  .bkempty b{display:block;font-family:\'Outfit\',sans-serif;font-size:17px;font-weight:700}',
    '  .bkempty p{margin:7px 0 0;font-size:13px;line-height:1.55;color:var(--ink-soft)}',
    '  .bkask{margin-top:12px;font-size:12.5px;line-height:1.55;color:var(--ink-faint);padding:0 2px}',
    '  .bksum{background:var(--surface);border-radius:var(--r-card);box-shadow:var(--sh-s);padding:16px 17px 14px;margin-top:14px}',
    '  .bksum .top{display:flex;align-items:baseline;justify-content:space-between;gap:10px}',
    '  .bksum .top b{font-family:\'Outfit\',sans-serif;font-size:16.5px;font-weight:700}',
    '  .bksum .top span{font-size:12.5px;color:var(--ink-faint);font-weight:600}',
    '  .bkbar{display:flex;gap:3px;margin-top:12px}',
    '  .bkbar i{height:5px;flex:1;border-radius:99px;background:var(--sage)}',
    '  .bkbar i.on{background:var(--deep)}',
    '',
  ].join('\n'), 'bookings css');

  // After the </section> that closes the day view, not before it — the first
  // version of this marker swallowed the closing tag and nested Bookings inside
  // Days, so it inherited [hidden] and rendered at zero height while insisting
  // it was visible.
  insertBefore('\n</div>\n\n<nav class="nav"', [
    '',
    '  <!-- ================= BOOKINGS ================= -->',
    '  <section class="view bk" id="v-book" hidden>',
    '    <div class="bkhead">',
    '      <span class="eyebrow">Before you go</span>',
    '      <h1 style="font-size:34px;font-weight:700;margin-top:8px">What still needs doing</h1>',
    '      <p class="bksub">Everything that has to be booked before you go, and everything already sorted.</p>',
    '    </div>',
    '    <div id="bookings"></div>',
    '  </section>',
    '',
  ].join('\n'), 'bookings view');

  const BOOK_TAB = [
    '  <button data-view="book" aria-selected="false">',
    '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5"/></svg>',
    // Named after the job, not the container. raffy, 2026-09-01: "in the trip
    // page itself ,i actually don't really understand what it means . or
    // booking" — then asked for a to-do list that the Wallet already held. A
    // wallet is a thing that holds stuff; it never said when to open it or
    // what you would do there. "To do" says both.
    '    <span>To do</span>',
    '  </button>',
  ].join('\n');

  // The tab order follows the trip, not the data model.
  //
  // raffy, 2026-09-01: "first todo, then explore, them day, last is trip".
  // Read left to right it is the order things actually happen — arrange it,
  // decide what is worth doing, see the plan, and Trip as the summary you show
  // someone who asks. The nav is rebuilt rather than appended to, because the
  // template's order (trip, map, days) is the reverse of that.
  replaceRegex(
    /<nav class="nav" id="nav">[\s\S]*?<\/nav>/,
    (() => {
      const src = lines.join('\n');
      const nav = src.match(/<nav class="nav" id="nav">([\s\S]*?)<\/nav>/);
      if (!nav) fail('nav: could not read the tab bar');
      const btns = nav[1].match(/<button[\s\S]*?<\/button>/g) || [];
      const of = (v) => btns.find((b) => b.includes('data-view="' + v + '"'));
      if (btns.length !== 3 || !of('trip') || !of('map') || !of('days')) {
        fail('nav: expected the three template tabs, got ' + btns.length);
      }
      const clean = (b) => b.replace(/aria-selected="[a-z]+"/, 'aria-selected="false"');
      return '<nav class="nav" id="nav">\n' + [BOOK_TAB, of('map'), of('days'), of('trip')]
        .map(clean).join('\n') + '\n</nav>';
    })(),
    'tab order: to do, explore, days, trip');

  // Which tab you land on depends on which phase the trip is in. Before you
  // go, the useful screen is what still has to be arranged; once you are
  // there, it is today. The old default — always the front page — was right
  // for neither.
  insertAfter("var nav=document.getElementById('nav');",
    "\n  (function(){ var i=pqIndex(pqNow()); setTimeout(function(){"
    + " setView(i>=0 && i<DAYS.length ? 'days' : 'book'); },0); })();",
    'land on the tab that matches the phase');



  insertAfter("var views={trip:document.getElementById('v-trip'),map:document.getElementById('v-map'),days:document.getElementById('v-days')};",
    "\n  views.book=document.getElementById('v-book');", 'register bookings view');

  // Rendered from the trip itself. A stay with `draft` set is one they have not
  // committed to, which is exactly the thing this tab exists to surface.
  // A wallet holds what you were given, not a summary of what you intend.
  //
  // raffy, 2026-09-01: "im not happy with the booking tab .feels superficial
  // especially like its an app."
  //
  // He was right, and the reason was structural rather than cosmetic. The first
  // version drew the same stays the Trip tab draws, with a badge added. It held
  // nothing you could not already see, so there was never a reason to open it —
  // a table of contents wearing a wallet's clothes.
  //
  // What makes it real is holding the actual confirmation: the reference you
  // read out at a counter, the terminal, the baggage line, the cancel-by date.
  // So T.bookings — records the traveller filed, by forwarding an email or just
  // saying it in chat — is now the content, and what the itinerary merely
  // implies is demoted to what is still outstanding.
  const BOOKINGS_JS = [
    '  function bkIcon(k){',
    '    if(k==="flight") return SHELLI.plane;',
    '    if(k==="stay") return \'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20V9l9-5 9 5v11"/><path d="M9 20v-6h6v6"/></svg>\';',
    '    if(k==="transfer") return \'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14"/><path d="M6.5 17l-1-5 2-4h9l2 4-1 5"/><circle cx="8.5" cy="17" r="1.5"/><circle cx="15.5" cy="17" r="1.5"/></svg>\';',
    '    if(k==="activity") return \'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V7h16v2a2 2 0 0 0 0 6v2H4v-2a2 2 0 0 0 0-6z"/><path d="M14 7v10"/></svg>\';',
    '    return \'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l4 4v14H7z"/><path d="M10 12h6M10 16h4"/></svg>\';',
    '  }',
    '',
    '  function bkCard(b){',
    '    var meta=[b.when,b.where].filter(Boolean).join(" \\u00b7 ");',
    '    var h=\'<div class="card" style="margin-bottom:9px"><div class="bkrow">\'+',
    '      \'<span class="bkicon">\'+bkIcon(b.kind)+\'</span><div class="bkbody"><b>\'+esc(b.title||"")+\'</b>\';',
    '    if(meta) h+=\'<div class="bkmeta">\'+esc(meta)+\'</div>\';',
    '    if(b.who) h+=\'<div class="bkmeta">\'+esc(b.who)+\'</div>\';',
    '    h+=\'</div></div>\';',
    '    if(b.ref) h+=\'<button class="bkref" type="button" data-copy="\'+esc(b.ref)+\'">\'+',
    '      \'<span class="k">Ref</span><span class="v">\'+esc(b.ref)+\'</span><span class="cp">Copy</span></button>\';',
    '    if(b.note) h+=\'<div class="bknote">\'+esc(b.note)+\'</div>\';',
    '    return h+\'</div>\';',
    '  }',
    '',
    '  function todoIcon(k){',
    '    if(k==="flight") return SHELLI.plane;',
    '    if(k==="stay") return bkIcon("stay");',
    '    if(k==="ticket") return bkIcon("activity");',
    '    if(k==="transfer"||k==="travel") return bkIcon("transfer");',
    '    if(k==="visa") return \'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M14 10h4M14 14h4M6 16h6"/></svg>\';',
    '    return bkIcon("other");',
    '  }',
    '',
    '  // One card is the whole life of one thing: what has to be booked, and',
    '  // then what was booked, with the reference on it.',
    '  //',
    '  // raffy, 2026-09-01: "the to do cards need to be more complete , based on',
    '  // context. if it has like booking / reference no, time , date ,/ address",',
    '  // and "the to do page seem so rigid and shallow".',
    '  //',
    '  // It was three lists — still to do, confirmed, sorted — describing the',
    '  // same hotel in three places, which is exactly how the Wallet went wrong',
    '  // the first time. Now the row carries whatever is known about the thing',
    '  // at whatever stage it is at, and the state is a chip on it rather than',
    '  // a heading above it.',
    '  function metaRow(icon, text){',
    '    return \'<div class="tdm">\'+icon+\'<span>\'+esc(text)+\'</span></div>\';',
    '  }',
    '  var MI = {',
    '    when:\'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>\',',
    '    at:\'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>\',',
    '    note:\'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>\',',
    '  };',
    '',
    '  function todoCard(t){',
    '    var b=t.booking||null;',
    '    var soon = !t.done && (t.due==="do this now"||t.due==="today"||t.due==="this week");',
    '    var h=\'<div class="card tdcard\'+(t.done?" is-done":"")+\'">\';',
    '    h+=\'<div class="bkrow"><span class="bkicon\'+(t.done?" soft":(soon?" hot":""))+\'">\'+',
    '      todoIcon(t.kind)+\'</span><div class="bkbody">\';',
    '    // Once it is done the verb is in the way: "Book Furama" is an',
    '    // instruction, and there is nothing left to instruct.',
    '    var name=(b&&b.title)||t.what||"";',
    '    if(t.done) name=name.replace(/^(Book|Confirm|Sort|Apply for|Arrange|Get|Buy|Renew)\\s+/i,"");',
    '    h+=\'<div class="tdtop"><b>\'+esc(name)+\'</b>\'+',
    '      \'<span class="bktag \'+(t.done?"ok":(soon?"no":"ok"))+\'">\'+',
    '      esc(t.done?"Booked":(t.due||"To book"))+\'</span></div>\';',
    '    // Whatever is actually known, in the order somebody would want it.',
    '    var when=(b&&b.when)||t.when||"";',
    '    // s.loc is prose in the itinerary — a paragraph about the',
    '    // neighbourhood. On a card it is an address line, so it gets the',
    '    // first sentence and nothing else.',
    '    var at=(b&&b.where)||t.addr||"";',
    '    if(at.length>90) at=at.replace(/([.;])\\s.*$/,"$1").slice(0,120);',
    '    var note=(b&&b.note)||t.note||"";',
    '    if(when) h+=metaRow(MI.when, when);',
    '    if(at) h+=metaRow(MI.at, at);',
    '    if(!t.done && t.why) h+=\'<div class="tdwhy">\'+esc(t.why)+\'</div>\';',
    '    if(note) h+=metaRow(MI.note, note);',
    '    h+=\'</div></div>\';',
    '',
    '    // The reference is the reason to open this card at a counter.',
    '    if(b&&b.ref) h+=\'<button class="bkref" type="button" data-copy="\'+esc(b.ref)+\'">\'+',
    '      \'<span class="k">Ref</span><span class="v">\'+esc(b.ref)+\'</span><span class="cp">Copy</span></button>\';',
    '',
    '    var foot="";',
    '    var lk=t.link||t.site||"";',
    '    if(!t.done && lk) foot+=\'<a class="tdgo" href="\'+esc(lk)+\'" target="_blank" rel="noopener noreferrer">\'+',
    '      \'<span>\'+(t.kind==="flight"?"Find flights":t.kind==="stay"?"Find rooms":"Book it")+\'</span>\'+',
    '      \'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" \'+',
    '      \'stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>\';',
    '    if(t.done && t.site) foot+=\'<a class="tdgo" href="\'+esc(t.site)+\'" target="_blank" rel="noopener noreferrer">\'+',
    '      \'<span>Their site</span>\'+',
    '      \'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" \'+',
    '      \'stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>\';',
    '    if(LIVE && !t.done) foot+=\'<button class="tddone" data-booked="\'+esc(t.what||"")+\'">\'+',
    '      \'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" \'+',
    '      \'stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>\'+',
    '      \'<span>Done it</span></button>\';',
    '    if(LIVE) foot+=\'<button class="tdx" data-droptask="\'+esc(t.what||"")+\'" \'+',
    '      \'aria-label="Take this off the list" title="Take this off the list">\'+',
    '      \'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" \'+',
    '      \'stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>\';',
    '    if(foot) h+=\'<div class="tdfoot">\'+foot+\'</div>\';',
    '    return h+\'</div>\';',
    '  }',
    '',
    '  function renderBookings(){',
    '    var el=document.getElementById("bookings"); if(!el) return;',
    '    var todo=(TODO&&TODO.todo)||[], done=(TODO&&TODO.done)||[], extra=(TODO&&TODO.extra)||[];',
    '    var need=todo.length+done.length, sorted=done.length;',
    '',
    '    var bars=""; for(var i=0;i<need;i++) bars+=\'<i class="\'+(i<sorted?"on":"")+\'"></i>\';',
    '    var h=need?\'<div class="bksum"><div class="top"><b>\'+sorted+\' of \'+need+\' sorted</b>\'+',
    '      \'<span>\'+(need-sorted)+\' left</span></div><div class="bkbar">\'+bars+\'</div></div>\':"";',
    '',
    '    // Grouped by when it has to happen, because that is the only thing',
    '    // that decides what you do next.',
    '    var soonish=function(t){ return t.due==="do this now"||t.due==="today"||t.due==="this week"; };',
    '    var now=todo.filter(soonish), later=todo.filter(function(t){ return !soonish(t); });',
    '    if(now.length){',
    '      h+=\'<div class="sect"><h2>This week</h2></div>\'+now.map(todoCard).join("");',
    '    }',
    '    if(later.length){',
    '      h+=\'<div class="sect"><h2>\'+(now.length?"After that":"Still to do")+\'</h2></div>\'+',
    '        \'<p class="tdlead">Nearest first.</p>\'+later.map(todoCard).join("");',
    '    }',
    '    if(!todo.length && need){',
    '      h+=\'<div class="bkempty"><span class="ico">\'+bkIcon("other")+\'</span>\'+',
    '        \'<b>You are all set</b><p>Nothing left to book. Have a good trip.</p></div>\';',
    '    }',
    '    if(LIVE){',
    '      h+=\'<button class="tdadd" type="button" data-addtask="1">\'+',
    '        \'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" \'+',
    '        \'stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>\'+',
    '        \'<span>Add something of your own</span></button>\';',
    '    }',
    '',
    '    if(done.length||extra.length){',
    '      h+=\'<div class="sect"><h2>Sorted</h2></div>\';',
    '      h+=done.map(todoCard).join("");',
    '      h+=extra.map(function(b){ return todoCard({ what:b.title, kind:b.kind||"other", done:true, booking:b }); }).join("");',
    '    } else if(need) {',
    '      h+=\'<div class="sect"><h2>Sorted</h2></div>\';',
    '      h+=\'<div class="bkempty"><span class="ico">\'+bkIcon("other")+\'</span>\'+',
    '        \'<b>Nothing filed yet</b><p>Once you have booked something, tap <b>Done it</b> \'+',
    '        \'and send me the confirmation \\u2014 an email, a screenshot, or just the \'+',
    '        \'reference. It lands here with the times and the address.</p></div>\';',
    '    }',
    '    el.innerHTML=h;',
    '  }',
    '',
    '  renderBookings();',
    '',
  ].join('\n');


  // --- "Change this", wherever the thing is ----------------------------------
  //
  // raffy, 2026-09-01: "include something like want to change the details ?
  // give the button to chat , then auto interactive message send to chat . chat
  // agent then make the edits... so we don't need the edit isolated section
  // anymore I think."
  //
  // He is right, and the reason is that the edit pane made changing something
  // a MODE. You left the trip, found the same item again in a list of form
  // fields, changed it, and came back. The button belongs on the thing itself.
  //
  // LIVE is simply "am I inside the chat app". The preview runs in an iframe
  // and the downloaded app does not, so `window.parent !== window` separates
  // them with no flag to plumb and no way for the two to disagree. A downloaded
  // itinerary has no agent to talk to, and correctly shows none of this.
  replaceOnce('      var tools=[];\n', [
    '      var tools=[];',
    '      if(LIVE) tools.push(\'<button class="evtool ask" data-ask="\'+',
    '        esc((r.it&&r.it.h)||r.h||"this")+\'" data-day="\'+i+\'">Change this</button>\');',
    '',
  ].join('\n'), 'ask button on every item');

  insertBefore('  function reduce(){', [
    '  var LIVE = (function(){ try { return window.parent !== window; } catch(e){ return false; } })();',
    '',
    '  // Copy is the point of a reference, so it says so afterwards rather than',
    '  // leaving you wondering whether the tap did anything.',
    '  //',
    '  // It lives HERE, next to the other delegated handlers, rather than inside',
    '  // the To do renderer where it started: rewriting that block deleted it',
    '  // twice, silently, because a listener leaves no trace when it is gone.',
    '  document.addEventListener("click", function(e){',
    '    var b = e.target.closest && e.target.closest(".bkref"); if(!b) return;',
    '    var v = b.getAttribute("data-copy") || "";',
    '    var say = function(){ var c=b.querySelector(".cp"); if(!c) return;',
    '      c.textContent="Copied"; b.classList.add("done");',
    '      setTimeout(function(){ c.textContent="Copy"; b.classList.remove("done"); },1600); };',
    '    if(navigator.clipboard && navigator.clipboard.writeText){',
    '      navigator.clipboard.writeText(v).then(say, function(){});',
    '    } else {',
    '      var t=document.createElement("textarea"); t.value=v; document.body.appendChild(t);',
    '      t.select(); try{ document.execCommand("copy"); say(); }catch(err){} t.remove();',
    '    }',
    '  });',
    '',
    '  // The ask is not sent, it is handed to the composer with the cursor after',
    '  // it. "Change dinner on Thu 10: " and then they type what they want —',
    '  // which is the same gesture as talking to the agent, minus finding the',
    '  // thing again in a form.',
    '  // Two ways to talk to the agent from inside the trip: change this, and',
    '  // I have done this. Same bridge, different intent.',
    '  document.addEventListener("click", function(e){',
    '    var add = e.target.closest && e.target.closest("[data-addtask]");',
    '    if(add){',
    '      try { window.parent.postMessage({ tripAsk: { what: "", kind: "addtask" } }, "*"); }',
    '      catch (err) {}',
    '      return;',
    '    }',
    '    var rm = e.target.closest && e.target.closest("[data-droptask]");',
    '    if(rm){',
    '      try {',
    '        window.parent.postMessage({',
    '          tripAsk: { what: rm.getAttribute("data-droptask"), kind: "droptask" },',
    '        }, "*");',
    '      } catch (err) {}',
    '      return;',
    '    }',
    '    var d = e.target.closest && e.target.closest("[data-booked]");',
    '    if(d){',
    '      try {',
    '        window.parent.postMessage({',
    '          tripAsk: { what: d.getAttribute("data-booked"), kind: "booked" },',
    '        }, "*");',
    '      } catch (err) { /* standalone: there is nobody to tell */ }',
    '      return;',
    '    }',
    '    var b = e.target.closest && e.target.closest("[data-ask]"); if(!b) return;',
    '    var di = parseInt(b.getAttribute("data-day"), 10);',
    '    var d = (typeof DAYS !== "undefined" && DAYS[di]) || null;',
    '    // The day chip shouts THU because it is a chip. A sentence should not.',
    '    var when = d ? (d.dow.charAt(0) + d.dow.slice(1).toLowerCase() + " " + d.dom) : "";',
    '    try {',
    '      // What they tapped, not a sentence with a colon hanging off it.',
    '      // The chat shows it as a label and keeps the box empty, so sending',
    '      // an unfinished instruction is not possible.',
    '      window.parent.postMessage({',
    '        tripAsk: { what: b.getAttribute("data-ask"), when: when },',
    '      }, "*");',
    '    } catch (err) { /* standalone: there is nobody to ask */ }',
    '  });',
    '',
  ].join('\n'), 'ask bridge');

  // The floating nav, and what was actually wrong with it.
  //
  // raffy, 2026-09-01: "should we make it cleaner (stick at the bottom or top)
  // so content of our app gets clearer."
  //
  // The island is not the problem and it is not dated — a floating tab bar is
  // what current phone OSes do, and it is half of why his Phu Quoc app looks
  // like an app. What made it feel dirty was the translucency: text slid behind
  // a 93%-opaque blur and came out HALF legible, which reads as a rendering
  // fault rather than as a layer. Half-hidden is the worst of both.
  //
  // So the bar is opaque. Whatever passes behind it is decisively gone, the
  // shape and the tuck-on-scroll are untouched, and it works over the pale page
  // and over a full-bleed dark card alike — which a gradient scrim does not: on
  // the dark trip card a fade tuned to the page background paints a light smear
  // across it. Nothing beats knowing when to paint nothing.
  //
  // Plus enough clearance that the last card clears the bar at rest.
  // The typefaces travel with the file. See renderer/fonts.js — the template
  // asks for them by relative path, which resolves next to the Phu Quoc app and
  // nowhere along the path a generated trip actually takes.
  replaceOnce(
    "@font-face{font-family:'Outfit';font-weight:100 900;font-style:normal;font-display:swap;src:url(fonts/outfit.woff2) format('woff2')}",
    FACE('Outfit', OUTFIT, '100 900'), 'embed Outfit');
  replaceOnce(
    "@font-face{font-family:'Jakarta';font-weight:200 800;font-style:normal;font-display:swap;src:url(fonts/jakarta.woff2) format('woff2')}",
    FACE('Jakarta', JAKARTA, '200 800'), 'embed Jakarta');

  // The preloads pointed at the same missing files. A preload that 404s is a
  // wasted request and a console error on every open.
  replaceRegex(/\s*<link rel="preload" as="font"[^>]*outfit\.woff2[^>]*>/, '', 'drop the Outfit preload');
  replaceRegex(/\s*<link rel="preload" as="font"[^>]*jakarta\.woff2[^>]*>/, '', 'drop the Jakarta preload');

  insertBefore('</style>', [
    '  .nav{background:#0E3125;backdrop-filter:none;-webkit-backdrop-filter:none}',
    '  .view{padding-bottom:132px}',
    '',
  ].join('\n'), 'solid nav');

  insertBefore('</style>', [
    '  .evtool.ask{color:var(--coral-text);text-decoration-color:rgba(238,123,69,.5)}',
    '',
  ].join('\n'), 'ask button css');

  // Tapping an idea that belongs to no area used to do nothing at all.
  //
  // openIdea reads `area.t` for the sheet's subtitle, and `area` is the result
  // of a filter — undefined for any idea without a matching area key. It threw
  // before the sheet opened, so the tap looked ignored. Harmless in the Phu
  // Quoc app, where every idea was hand-assigned an area; fatal here, because
  // "Worth a look" is made ENTIRELY of the ideas that have none.
  replaceOnce(
    "'<h2>'+d.n+'</h2><div class=\"sub\">'+area.t+' &middot; '+d.time+'</div></div>'+",
    "'<h2>'+d.n+'</h2><div class=\"sub\">'+[area&&area.t, d.time].filter(Boolean).join(' &middot; ')+'</div></div>'+",
    'an idea with no area still opens');

  // A missing field printed the word "undefined" into the sheet. `warn` is
  // optional in the schema and `why` can be short — the template concatenated
  // both straight in, because in the Phu Quoc app every idea was written by
  // hand and always had them.
  replaceOnce(
    "h+='<p style=\"margin:14px 0 0;font-size:15px;color:var(--ink-soft)\">'+d.why+'</p>';",
    "if(d.why) h+='<p style=\"margin:14px 0 0;font-size:15px;color:var(--ink-soft)\">'+esc(d.why)+'</p>';",
    'no why, no empty paragraph');
  replaceOnce(
    "h+='<div class=\"note'+(d.verdict==='yes'?'':' warm')+'\">'+(d.verdict==='yes'?I.info:I.warn)+'<div>'+d.warn+'</div></div>';",
    "if(d.warn) h+='<div class=\"note'+(d.verdict==='yes'?'':' warm')+'\">'+(d.verdict==='yes'?I.info:I.warn)+'<div>'+esc(d.warn)+'</div></div>';",
    'no catch, no empty note');

  // Links on every suggestion, wherever a suggestion appears.
  //
  // raffy, 2026-09-01: "everything we found , explore , all need photo and
  // relevant link , not just map . anywhere , in expanded card or as
  // suggestions in app."
  //
  // A map pin tells you where a place is. It does not let you buy the ticket,
  // read the menu or check today's times — which is the whole reason somebody
  // taps a suggestion they are interested in. The chat cards learned this
  // already; the app's own ideas had only `map`.
  replaceOnce(
    "if(d.warn) h+='<div class=\"note'+(d.verdict==='yes'?'':' warm')+'\">'+(d.verdict==='yes'?I.info:I.warn)+'<div>'+esc(d.warn)+'</div></div>';",
    "if(d.warn) h+='<div class=\"note'+(d.verdict==='yes'?'':' warm')+'\">'+(d.verdict==='yes'?I.info:I.warn)+'<div>'+esc(d.warn)+'</div></div>';\n"
    + "    h+=ideaLinks(d);",
    'links in the idea sheet');

  insertBefore('  function reduce(){', [
    '  // Everything the research turned up, then the map last and quiet — it is',
    '  // the fallback, not the destination.',
    '  function ideaLinks(d){',
    '    var seen={}, rows=[];',
    '    (d.links||[]).forEach(function(l){',
    '      if(!l||!l.url||!/^https?:\\/\\//i.test(l.url)) return;',
    '      var k=l.url.replace(/\\/+$/,"").toLowerCase(); if(seen[k]) return; seen[k]=1;',
    '      rows.push({label:l.label||"Open", url:l.url});',
    '    });',
    '    var m=d.map||("https://www.google.com/maps/search/"+encodeURIComponent(d.n));',
    '    if(!seen[m.replace(/\\/+$/,"").toLowerCase()]) rows.push({label:"Map", url:m, map:true});',
    '    if(!rows.length) return "";',
    '    return \'<div class="ilinks">\'+rows.map(function(r){',
    '      return \'<a href="\'+esc(r.url)+\'" target="_blank" rel="noopener noreferrer"\'+',
    '        (r.map?\' class="q"\':\'\')+\'>\'+esc(r.label)+\'</a>\';',
    '    }).join("")+\'</div>\';',
    '  }',
    '',
  ].join('\n'), 'idea links helper');

  insertBefore('</style>', [
    '  .wk{margin-top:6px}',
    '  .wk>summary{display:flex;align-items:center;gap:10px;cursor:pointer;list-style:none;',
    '    padding:2px 0 10px;-webkit-tap-highlight-color:transparent}',
    '  .wk>summary::-webkit-details-marker{display:none}',
    '  .wk>summary h2{margin:0;flex:1;min-width:0}',
    '  .wk .wkn{flex:none;min-width:22px;height:22px;border-radius:99px;background:var(--sage);',
    '    color:var(--deep);font-size:12px;font-weight:800;display:grid;place-items:center;padding:0 6px}',
    '  .wk .wkc{flex:none;width:18px;height:18px;color:var(--ink-faint);',
    '    transition:transform 200ms var(--e-out)}',
    '  .wk[open] .wkc{transform:rotate(180deg)}',
    '  .wk .wkb{display:flex;flex-direction:column;gap:9px;padding-bottom:2px}',
    '',
  ].join('\n'), 'worth knowing, folded');

  insertBefore('</style>', [
    '  .ilinks{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}',
    '  .ilinks a{display:inline-flex;align-items:center;gap:6px;padding:8px 13px;border-radius:var(--r-pill);',
    '    background:var(--sage);color:var(--deep);font-size:12.5px;font-weight:700;text-decoration:none}',
    '  .ilinks a:active{opacity:.6}',
    '  .ilinks a.q{background:none;color:var(--ink-faint);padding-left:4px}',
    '',
  ].join('\n'), 'idea links css');

  insertBefore('  function reduce(){', BOOKINGS_JS, 'bookings renderer');


  // --- the route map ---------------------------------------------------------
  //
  // raffy, 2026-09-01: "would it be too hard to do the map like in phu quoc ? i
  // really wish they have that map too like mine. it look nice." Then, catching
  // the hard part himself: "but the map will cover their destination journey.
  // u know what i mean? lke what if they go to two countries."
  //
  // That second thought is the whole design problem. The Phu Quoc map is a
  // hand-drawn island: an OSM polygon simplified to 168 points, markers nudged
  // offshore by hand. Lovely, and it describes one island at one zoom. It
  // cannot describe Kuala Lumpur to Bangkok to Hanoi.
  //
  // So: a REAL map underneath, drawn by Wikimedia at whatever zoom fits the
  // trip, tinted into the app's palette — and OUR illustration on top. The pins,
  // the numbering, the dashed route in date order are all ours, in the app's
  // language. What changes with scale is only the ground beneath them, which is
  // exactly the part that has to change.
  //
  // One island, one city, two countries, two continents: same component, and
  // the zoom is computed rather than chosen. No key, no library, and the tiles
  // are the ones already used for photo fallbacks.
  // The map moves to the head of Ideas rather than being a destination of its
  // own — you look at it to find what is near you, which is what Ideas is for.
  // Down here with the other insertions, not up beside the relabel: adding a
  // line mid-file shifts every absolute line range still to come. It happened
  // to be safe there and that is not a reason to leave it.
  if (!T.map) {
    insertBefore('    <div class="sect"><h2>In order</h2></div>',
      '    <div id="routemap" style="margin-bottom:6px"></div>\n', 'route map slot');
  }

  insertBefore('</style>', [
    // aspect-ratio holds the shape, not the image. The img used to be the only
    // thing in here with height, so a tile that failed to load collapsed the
    // whole map to nothing — the pins and route are absolutely positioned and
    // contribute none. It looked exactly like the feature was missing.
    // aspect-ratio holds the shape, not the images. A tile that fails to load
    // must never collapse the map — that looked exactly like the feature was
    // missing, and cost an evening.
    '  .rmap{position:relative;border-radius:var(--r-card);overflow:hidden;box-shadow:var(--sh-s);',
    '    background:var(--sage);aspect-ratio:512/640}',
    '  .rmap img.ground{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border:0}',
    '  .rmap svg{position:absolute;inset:0;width:100%;height:100%}',
    '  .rmap svg g.pin{cursor:pointer}',
    // Lifts the markers off the ground the way the Phu Quoc map does — without
    // it a photo circle reads as a hole cut in the map rather than a pin on it.
    '  .rmap svg g.pin{filter:drop-shadow(0 2px 5px rgba(12,36,27,.28))}',
    '  .rmap svg g.pin:active{opacity:.7}',
    // The map carried two floating captions, "In order" and "Tap a stop".
    // raffy, 2026-09-01: "remove tap a stop and in order from map. make the map
    // bigger a bit." Both were labelling things the picture already says — the
    // pins are numbered, and a pin on a map is obviously a pin — and both were
    // eating the corners of the only thing on the card worth looking at.
    '  .rlegend{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}',
    '  .rleg{display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border-radius:var(--r-pill);',
    '    background:var(--surface);box-shadow:var(--sh-s);font-size:12.5px;font-weight:600}',
    '  .rleg i{width:19px;height:19px;border-radius:99px;background:var(--coral);color:#3A1405;',
    '    display:grid;place-items:center;font-size:11px;font-weight:800;font-style:normal;flex:none}',
    '',
  ].join('\n'), 'route map css');

  insertBefore('  function reduce(){', [
    '  // Web Mercator, so a pin lands where the tiles actually put the place.',
    '  var TILE=256, MW=512, MH=640;',   // matches size= in pages/api/map.js
    '  function merc(lat,lon,z){',
    '    var s=TILE*Math.pow(2,z), sl=Math.sin(lat*Math.PI/180);',
    '    return { x:(lon+180)/360*s, y:(0.5-Math.log((1+sl)/(1-sl))/(4*Math.PI))*s };',
    '  }',
    '  // A smooth line through the stops rather than straight segments — the',
    '  // trip reads as a journey, which is what the Phu Quoc map got right.',
    '  function curve(p){',
    '    if(p.length<2) return "";',
    '    if(p.length===2){',
    '      // A straight line between two stays is a diagram. The Phu Quoc map',
    '      // bows its route, which is what makes it read as drawn rather than',
    '      // plotted, so two points get one gentle arc rather than a ruler.',
    '      var a=p[0], b=p[1];',
    '      var mx=(a.x+b.x)/2, my=(a.y+b.y)/2;',
    '      var dx=b.x-a.x, dy=b.y-a.y, len=Math.sqrt(dx*dx+dy*dy)||1;',
    '      // Perpendicular, bowed by a seventh of the run — enough to see, not',
    '      // enough to claim the road goes that way.',
    '      var ox=-dy/len*len*0.14, oy=dx/len*len*0.14;',
    '      return "M"+a.x.toFixed(1)+" "+a.y.toFixed(1)+" Q"+(mx+ox).toFixed(1)+" "+',
    '        (my+oy).toFixed(1)+","+b.x.toFixed(1)+" "+b.y.toFixed(1);',
    '    }',
    '    var d="M"+p[0].x+" "+p[0].y;',
    '    for(var i=0;i<p.length-1;i++){',
    '      var a=p[i], b=p[i+1];',
    '      var prev=p[i-1]||a, next=p[i+2]||b;',
    '      var c1x=a.x+(b.x-prev.x)/6, c1y=a.y+(b.y-prev.y)/6;',
    '      var c2x=b.x-(next.x-a.x)/6, c2y=b.y-(next.y-a.y)/6;',
    '      d+=" C"+c1x.toFixed(1)+" "+c1y.toFixed(1)+","+c2x.toFixed(1)+" "+c2y.toFixed(1)+',
    '        ","+b.x.toFixed(1)+" "+b.y.toFixed(1);',
    '    }',
    '    return d;',
    '  }',
    '  function renderRouteMap(){',
    '    var host=document.getElementById("routemap"); if(!host) return;',
    '    var pts=(T.stays||[]).map(function(s,i){',
    '      // The photo, not shotFor: shotFor falls back to a Wikimedia tile,',
    '      // and a map tile inside a pin ON a map is nonsense. No photo simply',
    '      // means the numbered dot.',
    '      return { i:i+1, n:s.short||s.n||"", lat:+s.lat, lon:+s.lon,',
    '        pic:(s.photo&&P[s.photo])?P[s.photo]:"" };',
    '    }).filter(function(p){ return isFinite(p.lat)&&isFinite(p.lon); });',
    '    if(!pts.length){ host.remove(); return; }',
    '',
    '    // Where they land, and the dashed hop in to the first stay.',
    '    //',
    '    // raffy, 2026-09-01: "i want some line from the map with like flight or',
    '    // car icon to the airport or something . just to make it like."',
    '    //',
    '    // It is drawn from real coordinates or not at all. A plane marker at a',
    '    // made-up position on a REAL map is a lie, and this app has a rule',
    '    // about that already. So the arriving flight carries the airport it',
    '    // lands at, and it is checked before it is believed: within about two',
    '    // degrees of the first stay, which is a plausible transfer and rules',
    '    // out a hallucinated one on another continent.',
    '    var air=null;',
    '    (function(){',
    '      // Only a trip somebody flies to has an airport on its map.',
    '      if((T.trip.arriveBy||"fly")!=="fly") return;',
    '      var f=(T.trip.flights||[]).filter(function(x){ return x.dir!=="back"; })[0];',
    '      if(!f||!isFinite(+f.lat)||!isFinite(+f.lon)) return;',
    '      var a={lat:+f.lat, lon:+f.lon};',
    '      if(Math.abs(a.lat-pts[0].lat)>2 || Math.abs(a.lon-pts[0].lon)>2) return;',
    '      air={lat:a.lat, lon:a.lon, code:f.to||"", from:f.from||"",',
    '        fromLat:isFinite(+f.fromLat)?+f.fromLat:null, fromLon:isFinite(+f.fromLon)?+f.fromLon:null};',
    '    })();',
    '',
    '    // A photo marker is 68 units across before its label, so the frame',
    '    // has to keep more room at the edges or the first stay is half off it.',
    '    var PAD=pts.some(function(p){return p.pic;})?96:76;',
    '    var fit=air?pts.concat([air]):pts;',
    '    var lats=fit.map(function(p){return p.lat;}), lons=fit.map(function(p){return p.lon;});',
    '    var cLat=(Math.min.apply(null,lats)+Math.max.apply(null,lats))/2;',
    '    var cLon=(Math.min.apply(null,lons)+Math.max.apply(null,lons))/2;',
    '',
    '    // Widest zoom first, stepping in until every stay fits with room for',
    '    // its pin. One stay has no span to fit, so it gets a city zoom.',
    '    var z=12;',
    '    if(pts.length>1){',
    '      for(z=15; z>1; z--){',
    '        var m=fit.map(function(p){return merc(p.lat,p.lon,z);});',
    '        var xs=m.map(function(q){return q.x;}), ys=m.map(function(q){return q.y;});',
    '        if(Math.max.apply(null,xs)-Math.min.apply(null,xs)<=MW-PAD*2 &&',
    '           Math.max.apply(null,ys)-Math.min.apply(null,ys)<=MH-PAD*2) break;',
    '      }',
    '    }',
    '',
    '    var c=merc(cLat,cLon,z), left=c.x-MW/2, top=c.y-MH/2, n=Math.pow(2,z);',
    '    var xy=pts.map(function(p){',
    '      var m=merc(p.lat,p.lon,z);',
    '      return { i:p.i, n:p.n, pic:p.pic, x:m.x-left, y:m.y-top };',
    '    });',
    '    var ap=null;',
    '    if(air){',
    '      var am=merc(air.lat,air.lon,z);',
    '      ap={x:am.x-left, y:am.y-top, code:air.code, from:air.from, bx:0, by:0, has:false};',
    '      // The direction they fly in from, as a true bearing rather than a',
    '      // decoration. Projected the same way as everything else, then cut',
    '      // to a stub — the real departure airport is thousands of miles off',
    '      // the frame, so the line says "from there" without pretending the',
    '      // whole flight fits on a map of one province.',
    '      if(air.fromLat!=null && air.fromLon!=null){',
    '        var fm=merc(air.fromLat,air.fromLon,z);',
    '        var vx=(fm.x-left)-ap.x, vy=(fm.y-top)-ap.y;',
    '        var vl=Math.sqrt(vx*vx+vy*vy);',
    '        // All the way out of the frame, not a stub.',
    '        //',
    '        // raffy, 2026-09-01: "the incoming leg from origin destination must',
    '        // go all the way to end of map . and it must start from the',
    '        // direction of the original country or city." A line that stops in',
    '        // open country reads as a route to nowhere; one that leaves the',
    '        // frame reads as coming from somewhere off it, which is the truth.',
    '        // The bearing is real — projected from the departure airport — so',
    '        // it exits on the side they actually fly in from.',
    '        if(vl>1){',
    '          var ux=vx/vl, uy=vy/vl;',
    '          // How far along the ray before it leaves the box, on whichever',
    '          // edge it reaches first.',
    '          var tx=ux>0?(MW-ap.x)/ux:(ux<0?(0-ap.x)/ux:Infinity);',
    '          var ty=uy>0?(MH-ap.y)/uy:(uy<0?(0-ap.y)/uy:Infinity);',
    '          var t=Math.min(tx,ty);',
    '          if(isFinite(t)&&t>0){ ap.bx=ap.x+ux*t; ap.by=ap.y+uy*t; ap.has=true; }',
    '        }',
    '      }',
    '    }',
    '',
    '    // One styled image from our own endpoint, so the Google key never',
    '    // reaches the page — a generated itinerary gets downloaded and shared.',
    '    // Wikimedia restricts hotlinking and Carto now wants a key of its own;',
    '    // both loaded on the server and failed on his phone. Static Maps also',
    '    // takes a style, so the ground is drawn in the app palette rather than',
    '    // somebody else\'s default, which is what gets it near the Phu Quoc map.',
    '    var ground=\'<img class="ground" alt="" src="/api/map?c=\'+cLat.toFixed(5)+\',\'+',
    '      cLon.toFixed(5)+\'&z=\'+z+\'">\';',
    '',
    '    var line="";',
    '    // The hop in from the airport, quieter than the route itself: this is',
    '    // how they get there, not part of where they go.',
    '    if(ap && xy.length){',
    '      var s0=xy[0];',
    '      var hmx=(ap.x+s0.x)/2, hmy=(ap.y+s0.y)/2;',
    '      var hdx=s0.x-ap.x, hdy=s0.y-ap.y, hl=Math.sqrt(hdx*hdx+hdy*hdy)||1;',
    '      var hd="M"+ap.x.toFixed(1)+" "+ap.y.toFixed(1)+" Q"+(hmx-hdy*0.12).toFixed(1)+" "+',
    '        (hmy+hdx*0.12).toFixed(1)+","+s0.x.toFixed(1)+" "+s0.y.toFixed(1);',
    '      line+=\'<path d="\'+hd+\'" fill="none" stroke="#FFFFFF" stroke-width="7" \'+',
    '        \'stroke-linecap="round" opacity=".85"/>\'+',
    '        \'<path d="\'+hd+\'" fill="none" stroke="#10362A" stroke-width="2.5" \'+',
    '        \'stroke-linecap="round" stroke-dasharray="7 8" opacity=".55"/>\';',
    '    }',
    '    if(xy.length>1){',
    '      var d=curve(xy);',
    '      // Dashed coral over a white casing. raffy, 2026-09-01: "draw like dash',
    '      // line rather than solid in between . doesn\'t have to be thick or too',
    '      // thin . just nice perfect for the look." Long dashes with round caps',
    '      // read as a journey; the dots this replaced read as a hint and',
    '      // vanished over dense streets at city zoom.',
    '      line=\'<path d="\'+d+\'" fill="none" stroke="#FFFFFF" stroke-width="9" \'+',
    '        \'stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>\'+',
    '        \'<path d="\'+d+\'" fill="none" stroke="#EE7B45" stroke-width="4" \'+',
    '        \'stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="12 10"/>\';',
    '    }',
    '',
    // A stay with a photo shows the photo, the way the Phu Quoc map does.
    //
    // raffy, 2026-09-01: "also possible to make map closer to how my phu quoc
    // look? like the no 1 and 2 is the image of the hotel .if possible."
    //
    // A picture of the place you are staying tells you more at a glance than a
    // numbered dot ever will, and it is the thing that makes his map read as
    // drawn rather than generated. Anything without a photo keeps the dot — a
    // grey placeholder circle would be worse than the honest small marker.
    '    var pins=xy.map(function(q){',
    '      var R=q.pic?30:12.5;',
    '      // Below the marker, not beside it. Beside means the label runs',
    '      // straight into the next stop along the route, which is exactly',
    '      // where the next pin tends to be. Below is clear unless the marker',
    '      // is near the bottom.',
    '      var below = q.y < MH-(R+30);',
    '      var head;',
    '      if(q.pic){',
    '        head=\'<clipPath id="pc\'+q.i+\'"><circle r="\'+R+\'"/></clipPath>\'+',
    '          \'<circle r="\'+(R+4)+\'" fill="#FFFFFF"/>\'+',
    '          \'<image href="\'+q.pic+\'" x="-\'+R+\'" y="-\'+R+\'" width="\'+(R*2)+\'" \'+',
    '          \'height="\'+(R*2)+\'" preserveAspectRatio="xMidYMid slice" \'+',
    '          \'clip-path="url(#pc\'+q.i+\')"/>\'+',
    '          (xy.length>1?\'<circle cx="\'+(R-4)+\'" cy="-\'+(R-4)+\'" r="13" fill="#10362A" \'+',
    '            \'stroke="#FFFFFF" stroke-width="2.5"/>\'+',
    '            \'<text x="\'+(R-4)+\'" y="-\'+(R-9)+\'" text-anchor="middle" \'+',
    '            \'font-family="Outfit,sans-serif" font-size="14" font-weight="800" \'+',
    '            \'fill="#EAF2EC">\'+q.i+\'</text>\':\'\');',
    '      } else {',
    '        head=\'<circle r="19" fill="#EE7B45" opacity=".18"/>\'+',
    '          \'<circle r="12.5" fill="#EE7B45" stroke="#FFFFFF" stroke-width="3"/>\'+',
    '          (xy.length>1?\'<text y="4.5" text-anchor="middle" font-family="Outfit,sans-serif" \'+',
    '            \'font-size="13" font-weight="800" fill="#3A1405">\'+q.i+\'</text>\':\'\');',
    '      }',
    '      return \'<g class="pin" data-stay="\'+(q.i-1)+\'" role="button" tabindex="0" \'+',
    '        \'aria-label="\'+esc(q.n)+\'" transform="translate(\'+q.x.toFixed(1)+\',\'+q.y.toFixed(1)+\')">\'+',
    '        \'<circle r="\'+(R+8)+\'" fill="transparent"/>\'+head+',
    '        \'<text x="0" y="\'+(below?R+20:-(R+10))+\'" text-anchor="middle" \'+',
    '          \'font-family="Outfit,sans-serif" font-size="14" font-weight="700" \'+',
    '          \'stroke="#FFFFFF" stroke-width="4" paint-order="stroke" fill="#0C241B">\'+',
    '          esc(q.n)+\'</text>\'+',
    '        \'</g>\';',
    '    }).join("");',
    '',
    '    var airpin="";',
    '    if(ap && ap.has){',
    '      // Drawn first so the airport marker sits on top of where it ends.',
    '      airpin+=\'<path d="M\'+ap.bx.toFixed(1)+\' \'+ap.by.toFixed(1)+\' L\'+ap.x.toFixed(1)+\' \'+',
    '        ap.y.toFixed(1)+\'" fill="none" stroke="#FFFFFF" stroke-width="6" \'+',
    '        \'stroke-linecap="round" opacity=".8"/>\'+',
    '        \'<path d="M\'+ap.bx.toFixed(1)+\' \'+ap.by.toFixed(1)+\' L\'+ap.x.toFixed(1)+\' \'+',
    '        ap.y.toFixed(1)+\'" fill="none" stroke="#10362A" stroke-width="2.5" \'+',
    '        \'stroke-linecap="round" stroke-dasharray="7 8" opacity=".5"/>\'+',
    '        (ap.from?\'<text x="\'+(ap.x+(ap.bx-ap.x)*0.74).toFixed(1)+\'" y="\'+',
    '          (ap.y+(ap.by-ap.y)*0.74-10).toFixed(1)+\'" \'+',
    '          \'text-anchor="middle" font-family="Outfit,sans-serif" font-size="11.5" \'+',
    '          \'font-weight="700" stroke="#FFFFFF" stroke-width="3.5" paint-order="stroke" \'+',
    '          \'fill="#4C6157">from \'+esc(ap.from)+\'</text>\':\'\');',
    '    }',
    '    if(ap){',
    '      // Appended, not assigned: the incoming leg is written above and this',
    '      // used to wipe it.',
    '      airpin+=\'<g class="airpin" transform="translate(\'+ap.x.toFixed(1)+\',\'+ap.y.toFixed(1)+\')">\'+',
    '        \'<circle r="15" fill="#FFFFFF"/>\'+',
    '        \'<circle r="15" fill="none" stroke="#10362A" stroke-width="1.5" opacity=".25"/>\'+',
    '        \'<g transform="translate(-9,-9) scale(0.75)" fill="none" stroke="#10362A" \'+',
    '        \'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\'+',
    '        \'<path d="M12 2.5c.9 0 1.6.8 1.6 1.7v5.1l7.4 4.3v2.1l-7.4-2.3v4.7l2.6 1.9v1.6L12 20.5\'+',
    '        \'l-4.2 1.1v-1.6l2.6-1.9v-4.7L3 15.7v-2.1l7.4-4.3V4.2c0-.9.7-1.7 1.6-1.7z"/></g>\'+',
    '        (ap.code?\'<text x="0" y="30" text-anchor="middle" font-family="Outfit,sans-serif" \'+',
    '          \'font-size="12" font-weight="700" stroke="#FFFFFF" stroke-width="3.5" \'+',
    '          \'paint-order="stroke" fill="#0C241B">\'+esc(ap.code)+\'</text>\':\'\')+',
    '        \'</g>\';',
    '    }',
    '',
    '    host.innerHTML=\'<div class="rmap">\'+ground+',
    '      \'<svg viewBox="0 0 \'+MW+\' \'+MH+\'" aria-hidden="true">\'+line+airpin+pins+\'</svg>\'+',
    '      \'</div>\'+',
    '      (xy.length>1?\'<div class="rlegend">\'+xy.map(function(q){',
    '        return \'<span class="rleg"><i>\'+q.i+\'</i>\'+esc(q.n)+\'</span>\';',
    '      }).join("")+\'</div>\':\'\');',
    '',
    '    // A map that will not load simply goes; the sage ground, the route and',
    '    // the labelled pins still read as the shape of the trip.',
    '    var g=host.querySelector("img.ground");',
    '    if(g) g.addEventListener("error", function(){ this.remove(); });',
    '',
    '    // Tapping a stop opens that stay, the same sheet the cards below open.',
    '    // raffy, 2026-09-01: "make it so that the location is clickable on the map".',
    '    Array.prototype.forEach.call(host.querySelectorAll("g.pin"), function(el){',
    '      var go=function(){ openSheet(+el.getAttribute("data-stay")); };',
    '      el.addEventListener("click", go);',
    '      el.addEventListener("keydown", function(e){',
    '        if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); }',
    '      });',
    '    });',
    '  }',
    '  renderRouteMap();',
    '',
  ].join('\n'), 'route map renderer');


  // --- no idea gets silently dropped -----------------------------------------
  //
  // raffy, 2026-09-01: "the ideas nearby tab, has nothing under ideas nearby.
  // maybe there we can put all the ideas to explore of the trip."
  //
  // The template renders ideas strictly inside AREAS.forEach, matching each
  // idea to an area key. Phu Quoc has four hand-written areas so every idea
  // found a home. A generated trip often has none — his Italy trip has two
  // ideas and zero areas — and the loop then produces nothing at all. The best
  // research the agent does, rendered as an empty heading.
  //
  // So: keep the grouping when areas exist, and sweep up everything they
  // missed underneath. A list that quietly drops its contents is worse than
  // one with an ugly heading.
  // Inserted before the decided-against box, matching it AFTER the renderer has
  // rewritten it — the original Phu Quoc markup no longer exists by this point.
  insertBefore("    h+=!(T.trip.declined && T.trip.declined.length)", [
    "    (function(){",
    "      var shown={};",
    "      AREAS.forEach(function(a){",
    "        IDEAS.forEach(function(d,i){ if(d.area===a.k) shown[i]=1; });",
    "      });",
    "      var rest=IDEAS.map(function(d,i){return i;}).filter(function(i){",
    "        return !shown[i] && IDEAS[i].verdict!=='must';",
    "      });",
    "      if(!rest.length) return;",
    "      // Only call it 'more' when something was grouped above it.",
    "      var any=Object.keys(shown).length;",
    "      h+='<div class=\"arearow\"><h3>'+(any?'More to explore':'Worth a look')+",
    "        '</h3><span class=\"ln\"></span><span class=\"near\">'+rest.length+' idea'+",
    "        (rest.length===1?'':'s')+'</span></div>';",
    "      h+='<div class=\"ideagrid\">';",
    "      rest.forEach(function(i){ h+=ideaCard(i); });",
    "      h+='</div>';",
    "    })();",
    '',
  ].join('\n'), 'ungrouped ideas');


  // --- Explore, as something you browse ---------------------------------------
  //
  // raffy, 2026-09-01: "i think the tab explore should list all the things we
  // find and suggest, integrated om days already good. but need different view
  // I think in explore. what do u think?"
  //
  // He is right, and the reason is upstream of the layout: an idea card was an
  // icon, a name and one line of text — the same shape as a day row and a stay
  // row. Three lists that look identical, so the tab had no reason to feel like
  // anywhere. Ideas now carry a photo, a rating and a price (they did not, while
  // the chat options always had all three), so Explore can be what it should be:
  // pictures in a grid, scanned rather than read, with the rating up front
  // because that is what the whole app recommends on.
  replaceRegex(
    /function ideaCard\(i\)\{[\s\S]*?<\/button>';\n  \}/,
    [
      "function ideaCard(i){",
      "    var d=IDEAS[i];",
      "    var src=d.photo&&P[d.photo]?P[d.photo]:'';",
      "    return '<button class=\"ideacard\" data-idea=\"'+i+'\">'+",
      "      '<span class=\"ipic\">'+(src?'<img src=\"'+esc(src)+'\" alt=\"\" loading=\"lazy\">':",
      "        '<span class=\"iph\">'+(II[d.icon]||I.pin||II.tower)+'</span>')+",
      "        (d.verdict==='must'?'<span class=\"ivd must\">Don\\u2019t miss</span>':",
      "          d.verdict==='yes'?'<span class=\"ivd\">Worth it</span>':'')+'</span>'+",
      "      '<span class=\"ibody\">'+",
      "        '<span class=\"it\">'+esc(d.n)+'</span>'+",
      "        (d.rating?'<span class=\"irate\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\">'+",
      "          '<path d=\"m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.2l5.9-.9z\"/>'+",
      "          '</svg>'+esc(d.rating)+'</span>':'')+",
      "        '<span class=\"is\">'+esc(d.one||'')+'</span>'+",
      "        '<span class=\"ifoot\">'+[d.price,d.time].filter(Boolean).map(esc).join(' &middot; ')+'</span>'+",
      "        (d.travel?'<span class=\"itrav\">'+esc(d.travel)+'</span>':'')+",
      "      '</span></button>';",
      "  }",
    ].join('\n'),
    'idea card as a picture');

  // Cards go in a grid; the area headings stay full width between them.
  replaceOnce(
    "      list.forEach(function(o){ h+=ideaCard(o.i); });",
    "      h+='<div class=\"ideagrid\">';\n" +
    "      list.forEach(function(o){ h+=ideaCard(o.i); });\n" +
    "      h+='</div>';",
    'group ideas into a grid');

  // Scoped to the card, not to #ideas.
  //
  // raffy, 2026-09-01, on the stay sheet: "in ideas in this area there's a big
  // font of writing im not sure what it is but it looks out of place." That was
  // the "Worth it" badge. The same ideaCard() renders in the stay sheet as in
  // Explore, but these rules were scoped to #ideas, so in the sheet the
  // template's original row layout won — a 38px icon column that the picture
  // area was squeezed into, with the badge falling out of it as plain oversized
  // text. One card, one set of rules, wherever it appears.
  insertBefore('</style>', [
    '  .ideagrid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:4px}',
    '  .ideacard{',
    // align-items has to be reset explicitly. The template lays this card out
    // as a centred grid row, and `align-items:center` survived the switch to a
    // flex column — which shrank the picture to the width of its own content,
    // i.e. zero. The card looked like it had a blank photo area on every idea;
    // it had no photo area at all.
    '    display:flex;flex-direction:column;align-items:stretch;gap:0;',
    '    text-align:left;padding:0;overflow:hidden;',
    '    background:var(--surface);border-radius:20px;box-shadow:var(--sh-s);width:100%;',
    '    transition:transform 160ms var(--e-out);',
    '  }',
    '  .ideacard:active{transform:scale(.975)}',
    // A fixed height, not aspect-ratio. As a flex item with only an absolutely
    // positioned child, aspect-ratio resolved to zero and the whole picture
    // area vanished on any idea without a photo — which is every existing trip.
    // Fixed also keeps the grid rows aligned, which is the point of a grid.
    '  .ipic{position:relative;display:block;width:100%;height:104px;overflow:hidden;',
    '    background:linear-gradient(150deg,var(--sage),rgba(238,123,69,.16))}',
    '  .ipic img{width:100%;height:100%;object-fit:cover;display:block}',
    '  .iph{position:absolute;inset:0;display:grid;place-items:center;color:var(--deep);opacity:.34}',
    '  .iph svg{width:30px;height:30px}',
    '  .ivd{',
    '    position:absolute;left:8px;top:8px;font-size:9.5px;font-weight:800;letter-spacing:.04em;',
    '    text-transform:uppercase;background:var(--coral);color:#3A1405;padding:3px 7px;border-radius:var(--r-pill);',
    '  }',
    '  .ibody{display:flex;flex-direction:column;gap:3px;padding:10px 11px 12px;min-width:0}',
    '  .it{font-family:\'Outfit\',sans-serif;font-size:14px;font-weight:700;line-height:1.2;letter-spacing:-.01em}',
    '  .irate{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:650;color:var(--ink-soft)}',
    '  .irate svg{width:11px;height:11px;flex:none;color:#E8A020}',
    '  .is{font-size:11.5px;line-height:1.4;color:var(--ink-faint);',
    '    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '  .ifoot{font-size:11px;font-weight:700;color:var(--coral-text);margin-top:2px}',
    '  .ideacard .go{display:none}',
    '',
  ].join('\n'), 'explore grid css');


  // The Explore headings, which still read as a footnote to the itinerary
  // rather than the point of the tab.
  replaceOnce(
    '      <h2>Ideas nearby</h2>\n      <span class="note" style="background:none;padding:0;font-size:12.5px">Not booked</span>',
    '      <h2>Everything we found</h2>',
    'explore section heading');
  replaceOnce(
    '<p style="margin:0 0 4px;font-size:13.5px;color:var(--ink-soft)">Places worth a look, grouped by where they are. Nothing here is in the plan yet.</p>',
    '<p style="margin:0 0 10px;font-size:13.5px;color:var(--ink-soft)">Not in your days yet. Tap one to see why it is worth your time.</p>',
    'explore blurb');


  // --- the best of the best, first and ungrouped -------------------------------
  //
  // raffy, 2026-09-01: "i only want to give the best out of the best only as
  // suggestions. main suggestion at least. like a must go if they are already
  // there especially for first timers." And, on the flip side: "im scared we
  // only limit to certain radius... they missed opportunity that are worth it
  // even if it far."
  //
  // Those are the same point. Grouping everything by area silently ranks the
  // list by distance — the temple two hours out gets filed under a heading
  // nobody scrolls to, beneath a café down the road. So the must-go handful
  // leads, ungrouped, with its travel time stated honestly; everything else
  // keeps its area grouping underneath, where proximity genuinely is the useful
  // way to read it.
  // Marker includes the next line: the orphan sweep above also contains an
  // AREAS.forEach, and the shorter string matches inside it.
  insertBefore('    AREAS.forEach(function(a){\n      var list=IDEAS', [
    "    var must=IDEAS.map(function(d,i){return {d:d,i:i};})",
    "      .filter(function(o){ return o.d.verdict==='must'; });",
    "    if(must.length){",
    "      h+='<div class=\"arearow\"><h3>Don\\u2019t miss</h3><span class=\"ln\"></span>'+",
    "        '<span class=\"near\">wherever they are</span></div>';",
    "      h+='<div class=\"ideagrid\">';",
    "      must.forEach(function(o){ h+=ideaCard(o.i); });",
    "      h+='</div>';",
    "    }",
    '',
  ].join('\n'), 'must-go section');

  // A must-go has already been shown at the top; do not print it twice.
  replaceOnce(
    "      var list=IDEAS.map(function(d,i){return {d:d,i:i};}).filter(function(o){return o.d.area===a.k;});",
    "      var list=IDEAS.map(function(d,i){return {d:d,i:i};})\n" +
    "        .filter(function(o){return o.d.area===a.k && o.d.verdict!=='must';});",
    'area list skips must-go');

  insertBefore('</style>', [
    '  .ivd.must{background:var(--deep);color:#EAF2EC}',
    '  .itrav{',
    "    display:inline-flex;align-items:center;gap:4px;margin-top:5px;font-size:10.5px;",
    '    font-weight:650;color:var(--ink-faint);',
    '  }',
    '',
  ].join('\n'), 'must-go css');

  // --- boot ------------------------------------------------------------------

  replaceOnce('  function reduce(){', '  renderShell();\n\n  function reduce(){', 'renderShell boot call');

  const out = lines.join('\n');

  const PHU_QUOC = [
    // The family's names belong here more than any hotel does: a leak of these
    // puts a stranger's children into someone else's itinerary. The first
    // version of this list checked the crew caption as one whole string, which
    // missed the "decided against" box that names Seth, Belle and Raes
    // individually in prose.
    'Seth', 'Belle', 'Raes', 'Syahirah', 'Raffy',
    'Coconut Tree Prison', 'Rach Vem', 'Ham Ninh', 'Ho Quoc', 'Suoi Tranh',
    'An Thoi', 'Hon Thom', 'Khem', 'Sao Beach', 'Duong Dong', 'Sanato',
    'Hi Raffy', 'Raffy, Syahirah, Seth, Belle and Raes', 'nine nights',
    'Kuala Lumpur', 'La Festa', 'Sunset Town', 'Vinpearl', 'JW Marriott',
    'Meliá', 'Khem Beach', 'Bai Dai', 'Grand World', 'VinWonders',
    '15 to 24 Aug', 'Phu Quoc', 'four hotels, two coasts', "' Aug &middot; '",
    'Island outline from OpenStreetMap',
  ];
  // Comments are not user-visible, and the template's explain why the clock is
  // built the way it is — genuinely useful to keep. Strip them before checking
  // so the guard only ever fires on something a traveller could actually read.
  const visible = out
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const tripJson = JSON.stringify(T);
  const leaks = PHU_QUOC.filter((s) => visible.includes(s) && !tripJson.includes(s));
  if (leaks.length) {
    fail('hardcoded Phu Quoc content survived into "' + T.trip.title + '": ' + leaks.join(', '));
  }

  return { html: out, applied };
}
