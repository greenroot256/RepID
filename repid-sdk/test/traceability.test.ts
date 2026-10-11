// Requirement-to-test traceability, checked in both directions.
//
// `constitution.md` Article 3 requires every requirement to have a real
// automated test. Three things have to be true for that claim to mean anything,
// and only the first is usually checked:
//
//   1. Every citation resolves to a test that exists. A table naming a test that
//      was renamed or deleted is worse than no table, because it reads as
//      coverage. This is why citations are resolved against the corpus rather than
//      trusted.
//   2. Every requirement is either cited or explicitly declared uncited, with a
//      reason. The reason is the part that makes progress possible: an undeclared
//      gap cannot be counted, so it never gets closed.
//   3. Coverage cannot silently regress. A floor per specification turns the gap
//      into a number that can only go up, and a test that fails when it does.
//
// The inventory of requirements is synced from the protocol repository rather
// than listed here, so a requirement added to a specification is picked up
// automatically. A requirement that appears in neither list therefore fails this
// suite, which is the intended behaviour: new work is visible until it is
// classified.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import inventory from './fixtures/requirements.json' with { type: 'json' };
import { COVERED, COVERAGE_FLOOR, SPEC_DEFAULT_REASON, UNCOVERED } from './traceability.manifest.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

interface Requirement {
  key: string;
  id: string;
  spec: string;
  specFile: string;
  section: string;
  kind: string;
  line: number;
  text: string;
}

const requirements = inventory.requirements as Requirement[];

/**
 * Test names declared in one file, normalised. Normalising matters because a
 * citation is a string in a table and a title in a source file: without it, a
 * non-breaking space or a smart quote turns a valid citation into a failure that
 * looks like a missing test.
 */
/**
 * Test names declared in one file, normalised. Normalising matters because a
 * citation is a string in a table and a title in a source file, and the two can
 * differ in ways that have nothing to do with the test existing:
 *
 *   - a test name containing an apostrophe is written `owner\'s` in the source,
 *     and the pattern must not stop at that quote;
 *   - the source may use a typographic apostrophe where the citation uses a
 *     plain one, which is the same character to a reader and a mismatch to a
 *     byte comparison.
 *
 * Treating a punctuation variant as a missing test would be the worst possible
 * failure for this file: it would push someone to delete a real citation or to
 * trust a mapping that no longer matches.
 */
function normalise(name: string): string {
  return name
    .replace(/\\(['"`\\])/g, '$1')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function declaredTests(file: string): Set<string> {
  const source = readFileSync(path.join(TEST_DIR, file), 'utf8');
  const names = new Set<string>();
  for (const match of source.matchAll(/\b(?:it|test)\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g)) {
    names.add(normalise(match[2]!));
  }
  return names;
}

// Loaded once: the corpus is a handful of files and the negative tests below
// resolve citations repeatedly.
const corpus = new Map(
  readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => [f, declaredTests(f)] as const),
);

const byKey = new Map(requirements.map((r) => [r.key, r]));

describe('requirement traceability (constitution.md Article 3)', () => {
  it('reads a non-empty inventory synced from the protocol repository', () => {
    // If this ever reads zero, the fixture is missing rather than the protocol
    // having no requirements, and every other assertion here would pass
    // vacuously.
    expect(requirements.length).toBeGreaterThan(0);
    expect(inventory.totals.declarations).toBe(requirements.length);
  });

  it('cites only requirements that exist', () => {
    const unknown = [
      ...Object.keys(COVERED),
      ...Object.keys(UNCOVERED),
    ].filter((key) => !byKey.has(key));

    expect(unknown).toEqual([]);
  });

  it('cites only tests that exist in the corpus', () => {
    const dangling: string[] = [];

    for (const [key, entry] of Object.entries(COVERED)) {
      for (const citation of entry.tests) {
        const separator = citation.indexOf(' :: ');
        if (separator === -1) {
          dangling.push(`${key}: malformed citation ${JSON.stringify(citation)}`);
          continue;
        }
        const file = citation.slice(0, separator);
        const name = normalise(citation.slice(separator + 4));
        const names = corpus.get(file);
        if (!names) {
          dangling.push(`${key}: no such test file ${file}`);
        } else if (!names.has(name)) {
          dangling.push(`${key}: ${file} has no test named ${JSON.stringify(name)}`);
        }
      }
    }

    expect(dangling).toEqual([]);
  });

  it('declares a reason for every requirement that is not cited', () => {
    // The failure this guards is the quiet one: a requirement added to a
    // specification and never classified. It would otherwise be invisible, and an
    // invisible requirement is one nobody is working on.
    const undeclared = requirements
      .map((r) => r.key)
      .filter((key) => !(key in COVERED))
      .filter((key) => !(key in UNCOVERED))
      .filter((key) => !(byKey.get(key)!.spec in SPEC_DEFAULT_REASON));

    expect(undeclared).toEqual([]);
  });

  it('gives every uncited requirement a reason, and every reason a subject', () => {
    for (const [spec, reason] of Object.entries(SPEC_DEFAULT_REASON)) {
      const declared = requirements.filter((r) => r.spec === spec);
      expect(declared.length, `${spec} has no requirements`).toBeGreaterThan(0);
      expect(reason.length, `${spec} has an empty reason`).toBeGreaterThan(20);
    }
    for (const [key, entry] of Object.entries(UNCOVERED)) {
      expect(entry.why.length, `${key} has an empty reason`).toBeGreaterThan(20);
      expect(entry.fix.length, `${key} has no stated fix`).toBeGreaterThan(5);
    }
  });

  it('holds coverage at or above the declared floor for every specification', () => {
    const report: string[] = [];
    const failures: string[] = [];

    for (const spec of [...new Set(requirements.map((r) => r.spec))].sort()) {
      const total = requirements.filter((r) => r.spec === spec).length;
      const cited = requirements.filter(
        (r) => r.spec === spec && r.key in COVERED,
      ).length;
      const share = cited / total;
      report.push(`  ${spec}: ${cited}/${total} cited (${(share * 100).toFixed(0)}%)`);

      const floor = COVERAGE_FLOOR[spec];
      if (floor !== undefined && share < floor) {
        failures.push(`${spec} fell to ${(share * 100).toFixed(0)}%, floor is ${(floor * 100).toFixed(0)}%`);
      }
    }

    const totalCited = requirements.filter((r) => r.key in COVERED).length;
    // Printed on every run so the number is visible in CI output rather than
    // only in this file. It is the number constitution.md Article 3 is about.
    console.log(`\nrequirement traceability: ${totalCited}/${requirements.length} cited\n${report.join('\n')}\n`);

    expect(failures).toEqual([]);
  });

  it('does not let a cited requirement claim a test that proves nothing', () => {
    // A citation with no test name would satisfy every check above while proving
    // nothing, so an entry must actually name something.
    const empty = Object.entries(COVERED)
      .filter(([, entry]) => entry.tests.length === 0)
      .map(([key]) => key);
    const unreasoned = Object.entries(COVERED)
      .filter(([, entry]) => entry.note.trim().length < 20)
      .map(([key]) => key);

    expect({ empty, unreasoned }).toEqual({ empty: [], unreasoned: [] });
  });
});
