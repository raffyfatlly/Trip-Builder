// Does this actually parse? Ask before pushing, not after Vercel does.
//
// raffy, 2026-09-07: "check if deployment ok in vercel." It was not — the
// production build had been failing since the toggle-pill commit, on a JSX
// comment written in an expression position:
//
//     {party && party.shared && (
//       {/* a comment */}          <-- valid in JSX, invalid here
//       <button ...>
//
// Nothing in this repo could have caught it. `node -e "import(...)"` is the
// check every commit ran, and it does not see .js files containing JSX — Next
// compiles those, node never loads them. So the one file most likely to break,
// pages/index.js at 2000+ lines, was the one file going out unparsed.
//
// Vercel keeps the last good deployment live when a build fails, so the site
// stayed up and every health check passed. The failure was completely silent
// from here: green site, broken build, three commits of work not live.
//
//   node setup/check-syntax.mjs            # every page and component
//   node setup/check-syntax.mjs a.js b.js  # just these
//
// Uses prettier's parser because it is installed globally and understands JSX.
// It parses only — nothing is rewritten, nothing is formatted.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let prettier;
try {
  prettier = require('/opt/node22/lib/node_modules/prettier');
} catch (e) {
  console.error('prettier not found — cannot check JSX. Skipping rather than');
  console.error('pretending the files are fine.');
  process.exit(0);
}

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const full = path.join(dir, d.name);
  if (d.isDirectory()) return d.name === 'node_modules' ? [] : walk(full);
  return /\.(js|jsx|mjs)$/.test(d.name) ? [full] : [];
});

const files = process.argv.length > 2
  ? process.argv.slice(2)
  : ['pages', 'components', 'lib'].filter((d) => fs.existsSync(d)).flatMap(walk);

let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  try {
    // format() throws on a syntax error; the output is discarded.
    await prettier.format(src, { parser: 'babel', filepath: f });
  } catch (err) {
    bad++;
    const msg = String((err && err.message) || err).split('\n').slice(0, 6).join('\n');
    console.error('\nFAIL ' + f + '\n' + msg);
  }
}

// PARSING IS NOT LOADING.
//
// 2026-09-08: a second `const named` in the same function passed every check
// here and then threw "Identifier 'named' has already been declared" the moment
// anything imported the file. Prettier parses one file in isolation; a
// duplicate binding is a scope error the module loader raises at
// instantiation, and lib/ is exactly where that matters — nothing in pages/
// compiles it, so a broken lib file reaches production as a 500.
//
// So every lib module is also IMPORTED. They are written to be import-safe
// already (config is loaded lazily, nothing calls out at module scope), which
// is what makes this cheap enough to run on every commit.
let dead = 0;
for (const f of files.filter((x) => x.startsWith('lib/'))) {
  try {
    await import('../' + f);
  } catch (err) {
    dead++;
    console.error('\nWILL NOT LOAD ' + f + '\n  ' + String((err && err.message) || err).split('\n')[0]);
  }
}

console.log('\n' + files.length + ' files checked, ' + (bad ? bad + ' FAILED' : 'all parse')
  + (dead ? ', ' + dead + ' WILL NOT LOAD' : ''));
process.exit(bad || dead ? 1 : 0);
