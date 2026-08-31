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
      '      <h1 style="font-size:34px;font-weight:700;margin-top:8px">Ideas and stays</h1>\n' +
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
        var fsrc = f.photo ? (P[f.photo]||'') : '';
        el.className = 'feature' + (fsrc ? '' : ' nophoto');
        el.innerHTML =
          (fsrc ? '<img src="' + esc(fsrc) + '" alt="' + esc(f.alt||'') + '" /><div class="veil"></div>' : '') +
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
      var notes = (tr.notes || []).filter(function(n){
        return !(n.stay != null && T.stays[n.stay] && !T.stays[n.stay].draft);
      });
      if(el){
        el.hidden = !notes.length && !tr.credits;
        el.innerHTML =
          (notes.length ? '<h2>Before you lock this in</h2>' : '') +
          notes.map(function(n){
            return '<div class="card">' + (SHELLI[n.kind === 'warn' ? 'warn' : 'info'] || '') +
              '<div><b>' + esc(n.h || '') + '</b> ' + esc(n.p || '') + '</div></div>';
          }).join('') +
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
    'b.innerHTML=(s.photo&&P[s.photo]?\'<img src="\'+P[s.photo]+\'" alt=""><div class="veil"></div>\':\'<div class="ph"></div><div class="veil"></div>\')+',
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
    "'<div class=\"lsub\">until you fly out'+(T.trip.flights&&T.trip.flights[0]?' of <b>'+esc(T.trip.flights[0].from)+'</b>':'')+'. '+esc(T.trip.titleSub||'')+', '+STAYS.length+(STAYS.length===1?' stay':' stays')+'.</div>'",
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
    replaceOnce('<span>Map</span>', '<span>Ideas</span>', 'relabel map tab as Ideas');
  }

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
