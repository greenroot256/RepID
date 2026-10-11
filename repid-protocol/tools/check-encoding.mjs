// Encoding checks over the tracked text files.
//
// Two failures that are invisible until something reads the file with the wrong
// assumptions, and that no other check would catch:
//
//   1. Mojibake. A file written as UTF-8 and read as cp1252 turns an em dash into
//      three characters. The text still renders, the file still parses, and the
//      tests still pass, so the damage survives review indefinitely. It was found
//      in `constitution.md`, in all 14 of its dash characters, in the document the
//      whole project derives from, because nobody was looking for it.
//
//   2. Mixed line endings. `.gitattributes` declares every text file LF, but a
//      working tree can still hold CRLF, and a pattern anchored with `$` then
//      matches nothing at all. `build-requirements.mjs` silently lost 70
//      declarations for exactly this reason before it learned to strip `\r`.
//
// The broken sequences are derived rather than written out. Spelling them as
// literals put the mojibake inside this file, so the check flagged its own
// source and `--fix-dashes` "repaired" the lookup table into a form that no longer
// detects anything. Deriving them from the character they should contain cannot
// happen.
//
// Usage: node tools/check-encoding.mjs [--fix-dashes]
//   --fix-dashes  rewrite a broken sequence back to the character it should be
//
// Exit codes: 0 ok, 1 problems found.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixDashes = process.argv.includes('--fix-dashes');

const TEXT = new Set([
  '.md', '.json', '.mjs', '.js', '.ts', '.cash', '.html', '.css', '.yml', '.yaml', '.txt',
]);
const SKIP_DIR = new Set(['.git', 'node_modules', 'dist', 'data', 'coverage']);

const REPLACEMENT = '\uFFFD';

/** What a character becomes when its UTF-8 bytes are read as cp1252. */
const mojibakeOf = (correct) => Buffer.from(correct, 'utf8').toString('latin1');

// Characters whose mojibake is worth catching, with the name used in the report.
const CHARACTERS = [
  ['\u2014', 'em dash'],
  ['\u2013', 'en dash'],
  ['\u201C', 'left double quote'],
  ['\u201D', 'right double quote'],
  ['\u2018', 'left single quote'],
  ['\u2019', 'right single quote'],
  ['\u00A0', 'non-breaking space'],
];

const SEQUENCES = CHARACTERS.map(([correct, label]) => ({
  correct,
  label,
  broken: mojibakeOf(correct),
})).filter(({ correct, broken }) => correct !== broken);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (TEXT.has(extname(entry.name))) out.push(full);
  }
  return out;
}

const problems = [];
const notes = [];
const files = walk(root);

for (const file of files) {
  const rel = relative(root, file).split(sep).join('/');
  const bytes = readFileSync(file);
  const text = bytes.toString('utf8');

  // Bytes that are not valid UTF-8 decode to the replacement character. That is
  // a louder failure than mojibake and is checked first, because a file in that
  // state cannot be meaningfully searched for mojibake.
  if (text.includes(REPLACEMENT)) {
    problems.push(`${rel}: contains U+FFFD, so the file is not valid UTF-8`);
  } else {
    for (const { broken, correct, label } of SEQUENCES) {
      const count = text.split(broken).length - 1;
      if (count > 0) {
        problems.push(
          `${rel}: ${count} broken ${label} (mojibake of U+${correct.codePointAt(0).toString(16).toUpperCase()})`,
        );
      }
    }
  }

  // Line endings, read from the bytes, because that is where they are recorded.
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      lf++;
      if (i > 0 && bytes[i - 1] === 0x0d) crlf++;
    }
  }
  // The distinction that matters is not "are there CRLF lines" but "which
  // endings dominate". A checkout converted wholesale to CRLF, 312 of 316 lines
  // here, is the local git configuration talking: `.gitattributes` normalises on
  // commit, so the stored blob is LF and the repository is not at fault. A file
  // that is mostly LF with a few CRLF lines is the opposite: something rewrote
  // part of one file, which is what made the requirement extractor silently drop
  // 70 declarations. Only that case fails.
  if (crlf > 0 && crlf * 2 < lf) {
    problems.push(`${rel}: mixed line endings (${crlf} CRLF of ${lf} lines); something rewrote part of this file`);
  } else if (crlf > 0) {
    notes.push(`${rel}: ${crlf === lf ? 'CRLF throughout' : `mostly CRLF (${crlf} of ${lf})`}, while .gitattributes declares LF (working-tree only; commits are normalised)`);
  }

  // A missing final newline makes the next append concatenate onto the last line,
  // which is how a requirement declaration ends up silently unmatched in a check.
  // It is a note rather than a failure because the repository has never claimed
  // the convention, and because `artifacts/` must stay byte-identical to what the
  // compiler emits, so it is exempt outright.
  if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a && !rel.startsWith('artifacts/')) {
    notes.push(`${rel}: no newline at end of file`);
  }
}

if (fixDashes) {
  let repaired = 0;
  for (const file of files) {
    const before = readFileSync(file, 'utf8');
    let after = before;
    for (const { broken, correct } of SEQUENCES) after = after.split(broken).join(correct);
    if (after !== before) {
      writeFileSync(file, after, 'utf8');
      console.log(`fixed ${relative(root, file).split(sep).join('/')}`);
      repaired++;
    }
  }
  if (repaired) {
    console.log(`\n${repaired} file(s) rewritten. Re-run to confirm.`);
  } else {
    console.log('nothing to repair.');
  }
  process.exit(0);
}

if (notes.length) {
  for (const n of notes) console.log(`  note  ${n}`);
}

if (problems.length) {
  console.error(`FAIL encoding check: ${problems.length} problem(s) in ${files.length} text files\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nRepaired with: node tools/check-encoding.mjs --fix-dashes');
  process.exit(1);
}

console.log(
  `\nOK: ${files.length} text files, valid UTF-8, no mojibake, no mixed line endings` +
    (notes.length ? `, ${notes.length} note(s)` : '') +
    '.',
);
