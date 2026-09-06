// Landmarks on the map, instead of another identical dot.
//
// raffy, 2026-09-06: "Improve map visuals by using recognizable, custom
// landmark icons (e.g., the Eiffel Tower for Paris, KLCC for Malaysia) rather
// than relying exclusively on generic map pins. not just one but good amount .
// but not too overwhelming . no need to label"
//
// Two tiers, because a curated landmark set can never cover the world:
//
//   NAMED     — the handful of things everybody can draw from memory. Matched
//               on the place's own name, so "Petronas Twin Towers" and "KLCC"
//               both find the towers.
//   CATEGORY  — temple, beach, mountain, market. Covers anywhere on earth, and
//               is what a trip to Kundasang or Madura actually gets.
//
// Anything that matches neither keeps the plain ring it has always had. That
// is the "not too overwhelming" half: an icon has to have been recognised to
// appear, so a map never fills up with vague shapes.
//
// "No need to label" is the other half, and it is a real simplification — the
// glyph carries the identity, so a marker with an icon drops its text and
// stops competing for label space with its neighbours.
//
// Drawing rules, so they read as one set:
//   - 24x24 box, drawn about the centre, stroke only, no fills
//   - stroke-width 1.8 at 24px, round caps and joins
//   - silhouette, not detail: it is rendered at about 16px on a phone

/** The glyphs. Keyed by icon name; the value is the path data only. */
export const GLYPHS = {
  // --- named landmarks ------------------------------------------------------
  petronas: 'M8 21V8.5L9.5 3l1.5 5.5V21M13 21V8.5L14.5 3 16 8.5V21M11 12h2M4 21h16',
  eiffel: 'M9 21c0-6 1.2-11 3-15 1.8 4 3 9 3 15M8.2 14h7.6M9.6 8.5h4.8M6 21h12M12 3v3',
  bigben: 'M9 21V9h6v12M10 9V6h4v3M12 3v3M10.5 12h3M12 12v1.8l1 .9M6 21h12',
  colosseum: 'M4 19V11a8 5.5 0 0 1 16 0v8M4 15h16M8 15v4M12 15v4M16 15v4M3 21h18',
  sagrada: 'M6 21V12l1.5-4L9 12v9M11 21V9l1.5-5L14 9v12M16 21v-8l1.3-3.4L18.6 13v8M4 21h16',
  marinabay: 'M6 21v-7M11 21v-7M16 21v-7M3.5 14h15a2.4 2.4 0 0 0 0-2.6h-15a2.4 2.4 0 0 0 0 2.6M3 21h16',
  tokyotower: 'M9 21c0-6 1.2-11 3-16 1.8 5 3 10 3 16M8.4 14h7.2M9.8 9h4.4M6 21h12M12 5V3',
  skytree: 'M12 3v18M9 21c0-5 1-9 3-13 2 4 3 8 3 13M9.5 12.5h5M8 21h8',
  fuji: 'M2 19h20M4.5 19 12 5.5 19.5 19M9 11.5l1.5 1.5 1.5-1.5 1.5 1.5L15 11.5',
  taj: 'M12 3.5c2.6 1.6 4 4 4 6.5v11M12 3.5c-2.6 1.6-4 4-4 6.5v11M8 14h8M5 21v-7M19 21v-7M3 21h18',
  burj: 'M12 2v19M9 21c0-7 1-12 3-15 2 3 3 8 3 15M10.4 12h3.2M7 21h10',
  operahouse: 'M2 19c0-5.5 3.2-9.5 7-9.5M8.8 19c0-4.5 2.6-7.6 5.8-7.6M15.4 19c0-3.4 2.2-5.6 4.6-5.6M2 19h20M2 21h20',
  liberty: 'M12 21v-7M9 14h6l-1.2-3h-3.6zM12 11V8.6M9.8 8.6c0-2.2 1.1-3.2 2.2-5.6 1.1 2.4 2.2 3.4 2.2 5.6zM8.5 21h7',
  redeemer: 'M12 21V8M4 11h16M12 8a1.7 1.7 0 1 0 0 .02M9 21h6M3 21c2.4-2.8 5.2-4 9-4s6.6 1.2 9 4',
  angkor: 'M5 21v-6l2-4 2 4v6M11 21V9l1-4 1 4v12M17 21v-6l2-4 2 4v6M3 21h18M3 17h18',
  watarun: 'M12 2.5 13 7l-1 1-1-1zM12 8l4.5 13h-9zM10 15h4M8.5 19h7M4 21h16',
  greatwall: 'M2 18c4-4 8-6 12-6s6 2 8 4M4 18v-3M8 15.6v-3M13 13.6v-3M18 15v-3M22 17v-3M2 21h20',
  pyramid: 'M2 20h20M4 20 12 4l8 16M8.8 13h6.4M12 4v16',
  goldengate: 'M2 20h20M6 20V5.5M18 20V5.5M2 12.5c4-5.4 8-5.4 8 0M14 12.5c0-5.4 4-5.4 8 0M6 8.6h12M6 20h12',
  brandenburg: 'M3 21V9h18v12M3 9l9-4 9 4M6 21v-8M10 21v-8M14 21v-8M18 21v-8M2 21h20',
  borobudur: 'M3 21h18M4.5 21v-3h15v3M6.5 18v-3h11v3M8.5 15v-3h7v3M11 12V9.5h2V12M12 9.5V7M10.6 7h2.8',

  // --- categories -----------------------------------------------------------
  temple: 'M12 3 4 8h16zM6 8v9M10 8v9M14 8v9M18 8v9M3 17h18M3 21h18M12 12v5',
  mosque: 'M12 4c2 1.6 3 3.4 3 5v3H9V9c0-1.6 1-3.4 3-5M5 21v-8a2 2 0 0 1 4 0M15 13a2 2 0 0 1 4 0v8M3 21h18M12 3V1.8',
  church: 'M12 2v4M10 4h4M12 6l5 5v10H7V11zM10.5 21v-4h3v4',
  beach: 'M12 20.5V11M4 11a8 8 0 0 1 16 0zM2 20.5c2-1.3 4-1.3 6 0s4 1.3 6 0 4-1.3 6 0',
  mountain: 'M2 19h20M3.5 19 9 9l3.5 6M11 19l4.5-8L21 19',
  volcano: 'M2 20.5h20M6 20.5 10 12h4l4 8.5M9.6 12h4.8M11 9.4c0-1.2 1-1.2 1-2.4M14.4 10c0-1.2 1-1.2 1-2.4',
  waterfall: 'M4 4h16M7 4v9M11 4v11M15 4v9M19 4v11M4 19c2-1.4 4-1.4 6 0s4 1.4 6 0 4-1.4 4 0',
  island: 'M2 19c2-1.4 4-1.4 6 0s4 1.4 6 0 4-1.4 6 0M12 16V9M12 9c-2.6 0-4.6 1.6-5.4 3.4h10.8C16.6 10.6 14.6 9 12 9M12 21h.01',
  market: 'M3 9h18l-1.5-4h-15zM5 9v11M19 9v11M3 20h18M9 20v-6h6v6',
  museum: 'M12 3 3 8h18zM6 11v7M10 11v7M14 11v7M18 11v7M3 18h18M3 21h18',
  castle: 'M4 21V8h4V5h2v3h4V5h2v3h4v13M9 21v-6h6v6M4 21h16',
  bridge: 'M2 19.5h20M5.5 19.5V6M18.5 19.5V6M5.5 8.6c4 4.4 9 4.4 13 0M5.5 12.6c4 3.4 9 3.4 13 0M9.5 19.5v-5M14.5 19.5v-5',
  park: 'M12 21v-6M12 15a5 5 0 1 0-3-9 4 4 0 0 0-1.5 7.6M12 15a5 5 0 0 0 4.6-6.8M8 21h8',
  garden: 'M12 21v-8M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 5V3M9 13c-2 0-3.5 1-4 2M15 13c2 0 3.5 1 4 2',
  zoo: 'M9 8a2.5 2.5 0 1 0 0 .01M15 8a2.5 2.5 0 1 0 0 .01M5.5 12.5a2 2 0 1 0 0 .01M18.5 12.5a2 2 0 1 0 0 .01M12 20c-3 0-4.5-2-4.5-4S9.5 12 12 12s4.5 2 4.5 4-1.5 4-4.5 4',
  aquarium: 'M4 12c3-4 8-5 12-2 1.5 1.1 2.5 2.4 3 3-2.5 3.4-6 4.6-9.4 3.6M4 12l3 3M4 12l3-3M19 13l2-2-2-2M13 11h.01',
  viewpoint: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  hotspring: 'M3 15h18a9 9 0 0 1-18 0M9 11c0-1.6 1.6-2 1.6-3.6S9 5.6 9 4M14.6 11c0-1.6 1.6-2 1.6-3.6S14.6 5.6 14.6 4',
  cablecar: 'M2 5h20M12 5v3M6 8h12v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM6 12h12M4 21h16',
  boat: 'M3 17.5h18l-2.6 3.5H5.6zM12 17.5V3M12 5.6l6.4 11.9H12M2 21h20',
  food: 'M6 3v8a2.5 2.5 0 0 0 5 0V3M8.5 11v10M17 3c-1.6 1-2.5 3-2.5 5.5V12H19V8.5C19 6 18.6 4 17 3M17 12v9',
  cafe: 'M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 9.5h2a2.5 2.5 0 0 1 0 5h-2M4 21h14M8 5V3M12 5V3',
  shopping: 'M6 8h12l-1 12H7zM9 8V6a3 3 0 0 1 6 0v2M9.5 11.5v1M14.5 11.5v1',
  nightlife: 'M5 5h14l-7 7zM12 12v7M8.5 19h7M17 3l1 2 2 .6-2 .8-1 2-1-2-2-.8 2-.6z',
  lake: 'M3 16c2-1.4 4-1.4 6 0s4 1.4 6 0 4-1.4 6 0M3 20c2-1.4 4-1.4 6 0s4 1.4 6 0 4-1.4 6 0M4 12l4-5 3 3.5L15 5l5 7',
  forest: 'M8 21v-4M8 17 4.5 12H6L3.5 8H7L5 4.5h6L9 8h3.5L10 12h1.5zM17 21v-5M17 16l-3-4.5h1.5L13.5 7H20l-2 4.5h1.5z',
  cave: 'M3 21V14a9 9 0 0 1 18 0v7M8 21v-5a4 4 0 0 1 8 0v5M2 21h20',
  airport: 'M12 2.5c.9 0 1.6.8 1.6 1.7v5.1l7.4 4.3v2.1l-7.4-2.3v4.7l2.6 1.9v1.6L12 20.5l-4.2 1.1v-1.6l2.6-1.9v-4.7L3 15.7v-2.1l7.4-4.3V4.2c0-.9.7-1.7 1.6-1.7',
  spa: 'M12 20.6c0-3.4 2.4-5.6 5.8-6.2-.6 4-3 6-5.8 6.2M12 20.6c0-3.4-2.4-5.6-5.8-6.2.6 4 3 6 5.8 6.2M12 20.6c-2.4-2.8-2.4-6.6 0-9.4 2.4 2.8 2.4 6.6 0 9.4',
};

/**
 * Which glyph a place gets, from its name alone.
 *
 * Order matters: a named landmark beats a category, and a longer phrase beats
 * a shorter one, so "Wat Arun" does not simply become "temple".
 *
 * WRITTEN AS ONE PLAIN FUNCTION ON PURPOSE. It is serialised with
 * Function.prototype.toString and spliced into the generated app (see
 * iconsJs below), so the app and the tests run the identical code and cannot
 * drift. Nothing in here may use syntax the splice cannot carry: no template
 * literals, no backticks, no dollar-brace.
 */
export function iconFor(name, NAMED, CATS) {
  var s = String(name == null ? '' : name).toLowerCase();
  if (!s) return '';
  var i;
  for (i = 0; i < NAMED.length; i++) {
    if (s.indexOf(NAMED[i][0]) !== -1) return NAMED[i][1];
  }
  for (i = 0; i < CATS.length; i++) {
    // Category words match on a word boundary, so "market" does not fire on
    // "Marketing Museum" and "spa" does not fire on "Spain". The optional s is
    // for plurals: "Marble Mountains" and "Batu Caves" both missed entirely
    // without it, which a screenshot of the map caught and the unit tests did
    // not, because every example anyone thinks to write is singular.
    if (new RegExp('(^|[^a-z])' + CATS[i][0] + 's?([^a-z]|$)').test(s)) return CATS[i][1];
  }
  return '';
}

/**
 * Named landmarks, longest phrase first so the specific one wins.
 * Plain substrings, lowercase.
 */
export const NAMED = [
  ['petronas', 'petronas'], ['klcc', 'petronas'], ['twin towers', 'petronas'],
  ['eiffel', 'eiffel'],
  ['big ben', 'bigben'], ['westminster', 'bigben'],
  ['colosseum', 'colosseum'], ['colosseo', 'colosseum'],
  ['sagrada', 'sagrada'],
  ['marina bay sands', 'marinabay'], ['gardens by the bay', 'garden'],
  ['tokyo tower', 'tokyotower'],
  ['skytree', 'skytree'], ['sky tree', 'skytree'],
  ['fuji', 'fuji'],
  ['taj mahal', 'taj'],
  ['burj khalifa', 'burj'], ['burj al arab', 'burj'],
  ['opera house', 'operahouse'],
  ['statue of liberty', 'liberty'],
  ['christ the redeemer', 'redeemer'], ['cristo redentor', 'redeemer'],
  ['angkor', 'angkor'],
  ['wat arun', 'watarun'], ['wat pho', 'watarun'], ['wat phra kaew', 'watarun'],
  ['great wall', 'greatwall'],
  ['pyramid', 'pyramid'], ['giza', 'pyramid'],
  ['golden gate', 'goldengate'],
  ['brandenburg', 'brandenburg'],
  ['kinabalu', 'mountain'],
  ['borobudur', 'borobudur'], ['prambanan', 'borobudur'],
];

/**
 * Categories. The word that has to appear, and the glyph it earns.
 * Longer and more specific first.
 */
export const CATS = [
  ['hot spring', 'hotspring'], ['hot springs', 'hotspring'], ['onsen', 'hotspring'],
  ['cable car', 'cablecar'], ['gondola', 'cablecar'], ['ropeway', 'cablecar'],
  ['night market', 'market'], ['bazaar', 'market'], ['market', 'market'],
  ['souk', 'market'], ['pasar', 'market'],
  ['waterfall', 'waterfall'], ['waterfalls', 'waterfall'], ['falls', 'waterfall'],
  ['air terjun', 'waterfall'],
  ['temple', 'temple'], ['wat', 'temple'], ['pagoda', 'temple'], ['shrine', 'temple'],
  ['jinja', 'temple'], ['candi', 'temple'], ['pura', 'temple'],
  ['mosque', 'mosque'], ['masjid', 'mosque'],
  ['cathedral', 'church'], ['basilica', 'church'], ['church', 'church'],
  ['chapel', 'church'], ['duomo', 'church'],
  ['beach', 'beach'], ['pantai', 'beach'], ['bay', 'beach'], ['cove', 'beach'],
  ['mountain', 'mountain'], ['mount', 'mountain'], ['peak', 'mountain'],
  ['gunung', 'mountain'], ['doi', 'mountain'], ['hill', 'mountain'],
  ['volcano', 'volcano'], ['crater', 'volcano'], ['kawah', 'volcano'],
  ['island', 'island'], ['pulau', 'island'], ['isle', 'island'],
  ['museum', 'museum'], ['gallery', 'museum'],
  ['castle', 'castle'], ['palace', 'castle'], ['fort', 'castle'], ['istana', 'castle'],
  ['bridge', 'bridge'], ['jambatan', 'bridge'],
  ['park', 'park'], ['taman', 'park'], ['forest', 'forest'], ['jungle', 'forest'],
  ['garden', 'garden'], ['gardens', 'garden'],
  ['zoo', 'zoo'], ['safari', 'zoo'], ['sanctuary', 'zoo'],
  ['aquarium', 'aquarium'], ['oceanarium', 'aquarium'],
  ['viewpoint', 'viewpoint'], ['lookout', 'viewpoint'], ['observatory', 'viewpoint'],
  ['cave', 'cave'], ['caves', 'cave'], ['gua', 'cave'],
  ['lake', 'lake'], ['tasik', 'lake'], ['danau', 'lake'], ['lagoon', 'lake'],
  ['airport', 'airport'],
  ['spa', 'spa'], ['massage', 'spa'],
  ['mall', 'shopping'], ['shopping', 'shopping'], ['plaza', 'shopping'],
  ['bar', 'nightlife'], ['club', 'nightlife'], ['rooftop', 'nightlife'],
  ['cafe', 'cafe'], ['coffee', 'cafe'], ['kopi', 'cafe'],
  ['restaurant', 'food'], ['warung', 'food'], ['eatery', 'food'],
  ['cruise', 'boat'], ['ferry', 'boat'], ['boat', 'boat'], ['pier', 'boat'],
];

/** Node-side convenience: the same matcher, with the tables already bound. */
export const iconNameFor = (name) => iconFor(name, NAMED, CATS);

/**
 * The whole thing as plain JS source, for splicing into the generated app.
 *
 * The matcher ships as its own source rather than being rewritten by hand for
 * the app, so there is exactly one implementation and the tests below cover
 * the code that actually runs on a traveller's phone.
 */
export function iconsJs() {
  return 'var GLYPHS=' + JSON.stringify(GLYPHS) + ';\n'
    + 'var NAMED=' + JSON.stringify(NAMED) + ';\n'
    + 'var CATS=' + JSON.stringify(CATS) + ';\n'
    + iconFor.toString().replace(/^export\s+/, '') + '\n'
    + 'function glyphFor(n){ var g=iconFor(n,NAMED,CATS); return g?GLYPHS[g]:""; }\n';
}
