// Extracts every requirement declaration from spec/ into protocol/requirements.json.
//
// Why this exists: `constitution.md` Article 3 requires that every requirement
// have a real automated test. That cannot be checked while the requirements live
// only in prose, because nothing knows how many there are. Counting them by hand
// is how a project ends up claiming coverage of "128 requirements" when it has
// 157, or mapping `RF-04` to a test when `RF-04` means six different things in
// six different specifications.
//
// The output is a machine-readable inventory. It is what a traceability check
// compares the test suites against, so the gap between a requirement and a test
// becomes a number that can go up or down rather than an impression.
//
// Requirement identifiers are NOT unique across specifications. SPEC-001 through
// SPEC-006 all use bare RF-01..RF-09, so nine identifiers are each declared in
// more than one specification. The key is therefore `SPEC-004/RF-04`, never the
// bare identifier. Renumbering the legacy specifications is a normative decision
// and is deliberately not made here.
//
// Usage: node tools/build-requirements.mjs [--check]
//   --check  verify the committed file is current; exit 1 if it is not.
//
// Exit codes: 0 ok, 1 problems found.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RF_DECLARATION } from './rf-declaration.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const specDir = join(root, 'spec');
const outFile = join(root, 'protocol', 'requirements.json');

// The shape of a declaration is defined once, in tools/rf-declaration.mjs, and
// shared with the guard in check-specs.mjs. Two private copies of this pattern
// could disagree about what parses, and then a requirement the inventory writes
// is exactly a requirement the guard cannot see coming.
const DECLARATION = RF_DECLARATION;

// A wrapped declaration continues on the following indented lines. A line that
// starts a new list item, a new heading, or a new unindented paragraph ends the
// statement. Note the two alternatives: a list/heading marker, or a line with no
// leading whitespace at all. Written as one `^\s*(...|\S)` pattern the second
// alternative would match any indented line too, because `\s*` consumes the
// indent before `\S` sees the first real character, and every continuation
// would be cut off after one word.
const CONTINUATION = /^\s{2,}\S/;
const TERMINATOR = /^(\s*([-*]\s|\d+\.\s|#{1,6}\s)|\S)/;

const specId = (file) => (file.match(/SPEC-\d{3}/) ?? ['UNKNOWN'])[0];

const requirements = [];

for (const file of readdirSync(specDir).filter((f) => f.endsWith('.md')).sort()) {
  // A checked-out working tree can carry CRLF even when the committed blob is
  // LF, depending on the local git configuration. Splitting on \n alone leaves a
  // trailing \r, and a pattern anchored with `$` then fails to match: `.` does
  // not match a line terminator, so every CRLF line silently vanishes from the
  // inventory and the requirement count comes out short. Stripping \r makes the
  // result independent of how the file was checked out.
  const lines = readFileSync(join(specDir, file), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.replace(/\r$/, ''));
  const spec = specId(file);
  let section = '';
  let paragraph = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track the nearest heading and paragraph so each requirement can be located
    // in the document by a human, not only by line number.
    const heading = line.match(/^(#{2,4})\s+(.*)$/);
    if (heading) {
      section = heading[2].trim();
      paragraph = '';
      continue;
    }
    if (/^#{2,4}\s/.test(line)) continue;

    const declaration = line.match(DECLARATION);
    if (!declaration) {
      if (/^\S/.test(line) && !/^\s*[-*]\s/.test(line)) paragraph = line.trim();
      continue;
    }

    // Absorb the wrapped continuation lines into one statement.
    let text = declaration[3].trim();
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (!CONTINUATION.test(next) || TERMINATOR.test(next)) break;
      if (DECLARATION.test(next)) break;
      text += ' ' + next.trim();
      i = j;
    }

    requirements.push({
      key: `${spec}/${declaration[1]}`,
      id: declaration[1],
      spec,
      specFile: file,
      section,
      paragraph,
      kind: declaration[2].trim(),
      line: i + 1,
      text,
    });
  }
}

// Reported so a duplicate is visible rather than silently collapsed. These
// declarations are distinct requirements that happen to share an identifier.
const byId = new Map();
for (const r of requirements) {
  if (!byId.has(r.id)) byId.set(r.id, []);
  byId.get(r.id).push(r.key);
}
const collisions = [...byId.entries()]
  .filter(([, keys]) => keys.length > 1)
  .map(([id, keys]) => ({ id, keys }))
  .sort((a, b) => a.id.localeCompare(b.id));

const inventory = {
  note:
    'Generated by tools/build-requirements.mjs from spec/*.md. Do not edit by hand. ' +
    'A requirement is keyed by `SPEC-NNN/RF-Xnn` because the bare identifier is not ' +
    'unique: SPEC-001 through SPEC-006 all use RF-01..RF-09.',
  source: 'spec/*.md',
  generatedFrom: {
    specifications: readdirSync(specDir).filter((f) => f.endsWith('.md')).sort(),
  },
  totals: {
    declarations: requirements.length,
    distinctIdentifiers: byId.size,
    collidingIdentifiers: collisions.length,
    bySpecification: Object.fromEntries(
      [...new Set(requirements.map((r) => r.spec))]
        .sort()
        .map((s) => [s, requirements.filter((r) => r.spec === s).length]),
    ),
  },
  collisions,
  requirements,
};

const serialized = `${JSON.stringify(inventory, null, 2)}\n`;
const check = process.argv.includes('--check');

if (check) {
  if (!existsSync(outFile)) {
    console.error(`FAIL ${outFile} does not exist. Run: node tools/build-requirements.mjs`);
    process.exit(1);
  }
  if (readFileSync(outFile, 'utf8') !== serialized) {
    console.error(
      'FAIL protocol/requirements.json is stale: it does not match the declarations in spec/.\n' +
        '     Run: node tools/build-requirements.mjs',
    );
    process.exit(1);
  }
  console.log(`OK: requirements.json matches spec/ (${requirements.length} declarations).`);
} else {
  writeFileSync(outFile, serialized, 'utf8');
  console.log(`Wrote ${outFile}`);
  console.log(`  declarations          : ${requirements.length}`);
  console.log(`  distinct identifiers  : ${byId.size}`);
  console.log(`  colliding identifiers: ${collisions.length}`);
  for (const { id, keys } of collisions) {
    console.log(`    ${id.padEnd(8)} -> ${keys.join(', ')}`);
  }
}
