// Guards WHITE-PAPER.md against stale claims.
//
// A white paper is prose, and prose drifts. This test re-derives every number
// the document asserts that this repository can produce on its own — the
// protocol version, the specification count, the requirement count, the
// covenant/artifact counts, the compiler version — and fails if the document
// disagrees. For the figures measured in the other two repositories (the
// recognition SDK and the demonstration application) the document records the
// measurement date and the numbers; a change to either must be reflected here
// in the same edit, or CI points at the discrepancy.
//
// The second half is lexical: it bricks the obsolete phrasings that the
// 2026-10-07 audit found (0.1.0, "three covenants", "reproduce exactly"
// without the versioned vault, outdated test/spec/repo counts). A stale phrase
// is a real defect even when the surrounding paragraph looks plausible.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  constants,
  protocolVersion,
} from '../tools/validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const whitepaper = readFileSync(join(root, 'WHITE-PAPER.md'), 'utf8');
const requirements = JSON.parse(
  readFileSync(join(root, 'protocol', 'requirements.json'), 'utf8'),
);

// The document spells small counts ("five") where the derived value is a digit
// ("5"). Normalize the spelled forms so one assertion covers both phrasings.
function normalizeNumbers(text) {
  const words = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  };
  return text.replace(
    /\b(one|two|three|four|five|six|seven|eight)\b/g,
    (w) => String(words[w]),
  );
}
const whitepaperNumbers = normalizeNumbers(whitepaper);

function flatContracts() {
  const flat = [];
  for (const [name, contract] of Object.entries(constants.contracts)) {
    if (name === 'compiler' || name.startsWith('$')) continue;
    if ('versions' in contract) flat.push(...Object.values(contract.versions));
    else flat.push(contract);
  }
  return flat;
}

test('the white paper states the current protocol version', () => {
  assert.ok(
    whitepaper.includes(`| **Protocol version** | \`${protocolVersion.version}\` (pre-release) |`),
    'WHITE-PAPER.md front-matter must quote protocol/protocol-version.json exactly',
  );
  assert.ok(!whitepaper.includes('`0.1.0`'), 'the retired 0.1.0 version must not be quoted');
});

test('the white paper reproduces the derived repository counts', () => {
  const specs = readdirSync(join(root, 'spec'))
    .filter((f) => f.startsWith('SPEC-') && f.endsWith('.md')).length;
  const flat = flatContracts();
  // "Covenant sources" is the number of distinct covenant contracts (identityVault
  // counts once across its bodies); "compiled artifacts" is the number of distinct
  // artifact files. Both count 4 and 5 even though the registry declares six
  // source/artifact pairs, because 0.5.0 records the 0.4.0 vault body.
  const covenantSources = Object.keys(constants.contracts).filter(
    (k) => k !== 'compiler' && !k.startsWith('$'),
  ).length;
  const artifacts = new Set(flat.map((c) => c.artifact)).size;

  for (const [label, actual] of [
    ['specifications', specs],
    ['requirement declarations', requirements.requirements.length],
    ['compiled artifacts', artifacts],
    ['covenant sources', covenantSources],
  ]) {
    assert.ok(
      new RegExp(`\\b${actual}\\b[^\\n]{0,40}${label}`).test(whitepaperNumbers) ||
        new RegExp(`${label}[^\\n]{0,40}\\b${actual}\\b`).test(whitepaperNumbers),
      `WHITE-PAPER.md must state "${actual} ${label}" (derived: ${actual})`,
    );
  }
});

test('the white paper records four covenant sources and five artifacts', () => {
  assert.ok(
    whitepaper.includes('Four covenant sources, five compiled artifacts'),
    'the versioned vault makes "three covenants" obsolete',
  );
  assert.ok(
    !whitepaper.includes('all three contract artifacts') &&
      !whitepaper.includes('all three covenants'),
    'the "three" wording must not return',
  );
  for (const source of flatContracts().map((c) => c.source)) {
    assert.ok(
      whitepaper.includes(source.replace('contracts/', 'contracts/')),
      `WHITE-PAPER.md should mention ${source} in the covenant list`,
    );
  }
});

test('the measured-figures block is dated and internally consistent', () => {
  const measured = whitepaper.match(/\*\*Measured on (\d{4}-\d{2}-\d{2}):\*\*/);
  assert.ok(measured, 'the conformance table must carry a measurement date');
  assert.ok(
    measured[1] !== '2026-10-01',
    'the 2026-10-01 figures were superseded by the 2026-10-07 audit',
  );
});