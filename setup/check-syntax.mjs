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

console.log('\n' + files.length + ' files checked, ' + (bad ? bad + ' FAILED' : 'all parse'));
process.exit(bad ? 1 : 0);
