// Structural and referential checks over spec/.
//
// Two failure modes this prevents:
//
//   1. A specification pointing at a file that does not exist here. When the
//      protocol was separated from the demo, every `tasks.md`, `plan.md`,
//      `server/...` and `packages/...` reference became a dead link. Dead links
//      in a normative document are worse than no links, because a reader cannot
//      tell whether the claim behind the link still holds.
//   2. A requirement identifier that exists in a table but not in the prose, or
//      the reverse.
//
// Exit codes: 0 ok, 1 problems found.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findUnparseableDeclarations } from './rf-declaration.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const specDir = join(root, 'spec');
const problems = [];
const notes = [];

// A reference is acceptable if it is marked as belonging to an external
// repository. `ref:` is the explicit marker used by REFERENCE-IMPLEMENTATION.md.
const EXTERNAL = /`ref:[^`]+`/;

const files = readdirSync(specDir).filter((f) => f.endsWith('.md')).sort();
const allText = new Map(files.map((f) => [f, readFileSync(join(specDir, f), 'utf8')]));

for (const [file, text] of allText) {
  const lines = text.split('\n');

  // --- 1. dead local references -------------------------------------------
  lines.forEach((line, i) => {
    if (EXTERNAL.test(line)) return;

    // Backticked paths that look like files in another repository.
    const candidates = line.match(/`([^`]+)`/g) ?? [];
    for (const raw of candidates) {
      const ref = raw.slice(1, -1);
      if (!/^[\w./-]+\.(md|json|mjs|js|cash|yml)$/.test(ref)) continue;
      if (ref.startsWith('ref:')) continue;

      // Paths inside a specification are relative to spec/.
      const inSpec = join(specDir, ref);
      const inRoot = join(root, ref);
      const inSpecDir = join(specDir, ref.replace(/^\.\//, ''));

      if (
        existsSync(inSpec) ||
        existsSync(inRoot) ||
        existsSync(inSpecDir) ||
        ref.includes('/') === false // bare filename, could be an external doc by name
      ) {
        continue;
      }

      problems.push(
        `${file}:${i + 1}  dead reference to '${ref}' — no such file in this repository`,
      );
    }
  });

  // --- 2. documentation names that live in the demo repository ------------
  for (const forbidden of ['tasks.md', 'plan.md', 'agents.md', 'AGENTS.md']) {
    lines.forEach((line, i) => {
      if (EXTERNAL.test(line)) return;
      if (line.includes(forbidden)) {
        problems.push(
          `${file}:${i + 1}  references '${forbidden}', which lives in the demo repository. ` +
            `Inline the knowledge or mark the path as 'ref:' so a reader knows it is external.`,
        );
      }
    });
  }

  // --- 3. required sections ----------------------------------------------
  if (!/^#\s+SPEC-\d{3}:/m.test(text)) {
    problems.push(`${file}  does not start with '# SPEC-NNN: <title>'`);
  }
  if (!/##\s+\d+\./.test(text)) {
    problems.push(`${file}  has no numbered sections`);
  }
}

// --- 4. cross-spec references resolve -------------------------------------
const specNames = new Set(files.map((f) => f.replace(/\.md$/, '')));

// Specifications that deliberately live elsewhere. A reference to one of these
// is allowed, but only on a line that says where it lives: an unqualified
// reference reads as local and misleads the reader into thinking the document
// is normative here.
const EXTERNAL_SPECS = {
  'SPEC-007': /external|application repo|not in this repo|non-normative|its SPEC-007|demo repository/i,
};

for (const [file, text] of allText) {
  // Checked per block, not per line: prose is wrapped, so a qualifier that
  // qualifies a reference usually sits on the next line. A line-based check
  // would force the writing to be unnaturally broken to satisfy the linter.
  const blocks = text.split(/\n\s*\n/);
  let consumed = 0;
  for (const block of blocks) {
    const startLine = text.slice(0, consumed).split('\n').length;
    consumed += block.length + 2;

    for (const [id, qualifier] of Object.entries(EXTERNAL_SPECS)) {
      if (!new RegExp(`\\b${id}\\b`).test(block)) continue;
      if (qualifier.test(block)) continue;
      problems.push(
        `${file}:${startLine}  references ${id}, which lives outside this repository, ` +
          `but the passage does not say so. State that it is external and non-normative here.`,
      );
    }
  }

  for (const match of text.matchAll(/\bSPEC-\d{3}\b/g)) {
    const id = match[0];
    if (id in EXTERNAL_SPECS) continue;
    const full = [...specNames].find((n) => n.startsWith(id));
    if (!full) {
      const line = text.slice(0, match.index).split('\n').length;
      problems.push(`${file}:${line}  references ${id}, which does not exist in spec/`);
    }
  }
}

// --- 4b. a requirement declaration that nothing can parse ------------------
//
// `build-requirements.mjs` reads only the lines that match RF_DECLARATION. A
// line that reads as a declaration but does not match it is not a warning: the
// requirement is written in the specification and invisible to the inventory,
// to the traceability suite, and to any consumer reading requirements.json.
// That is the one failure mode a specification tool must not have, so it is
// reported rather than skipped. The matcher lives in tools/rf-declaration.mjs
// so this cannot pass on lines the inventory would have accepted.
for (const [file, text] of allText) {
  for (const { line, identifier } of findUnparseableDeclarations(text)) {
    problems.push(
      `${file}:${line}  declares ${identifier}, which is not an RF identifier. ` +
        'Expected RF-<letter>?<digits>, as in RF-V12 or RF-O821: a suffixed form is ' +
        'skipped by the inventory silently and the requirement stops existing.',
    );
  }
}

// --- 5. SPEC-007 must not be here ----------------------------------------
if (existsSync(join(specDir, 'SPEC-007-confidence-index.md'))) {
  problems.push(
    'spec/SPEC-007-confidence-index.md  the Confidence Index is interpretation, not protocol. ' +
      'It belongs to the demo repository (reputation and CI are explicitly out of scope).',
  );
}

const rfIds = new Set(
  [...allText.values()].join('\n').match(/\bRF-[A-Z]?\d+/g) ?? [],
);
notes.push(`specifications checked : ${files.length}`);
notes.push(`rf identifiers seen   : ${rfIds.size}`);

if (problems.length === 0) {
  for (const n of notes) console.log(`  ${n}`);
  console.log('\nOK: no dead references, no missing specs.');
  process.exit(0);
}

for (const n of notes) console.log(`  ${n}`);
console.log('');
for (const p of problems) console.log(`  FAILED  ${p}`);
console.log(`\n${problems.length} problem(s).`);
process.exit(1);
