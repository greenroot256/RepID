import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RF_DECLARATION,
  findUnparseableDeclarations,
} from '../tools/rf-declaration.mjs';

// The guard that reads a specification exists because of a specific accident:
// a requirement was written as RF-O08a, `RF_DECLARATION` did not match it,
// and the requirement vanished from protocol/requirements.json without an
// error anywhere. These tests pin the guard down on both sides, because a
// guard that flags prose would be turned off within a week and the accident
// would repeat.

// --- it must flag the shapes that used to pass silently ---------------------

test('flags a suffixed identifier, the shape that was skipped silently', () => {
  const found = findUnparseableDeclarations(
    '- **RF-O08a** (Ubiquity): An implementation **MUST** do the thing.',
  );

  assert.equal(found.length, 1);
  assert.equal(found[0].identifier, 'RF-O08a');
  assert.equal(found[0].line, 1);
});

test('flags a malformed identifier even when the qualifier is present', () => {
  // The qualifier is what makes this a declaration, not a mention.
  const found = findUnparseableDeclarations(
    ['- **RF-V** (Security): no digits at all.'].join('\n'),
  );

  assert.equal(found.length, 1);
  assert.equal(found[0].identifier, 'RF-V');
});

test('flags a declaration that lost its qualifier', () => {
  const found = findUnparseableDeclarations('- **RF-V12**: dropped the qualifier.');

  assert.equal(found.length, 1);
  assert.equal(found[0].identifier, 'RF-V12');
});

test('reports the line a human can go and look at', () => {
  const found = findUnparseableDeclarations(
    ['# SPEC-001', '', 'text', '- **RF-O08a** (Options): the third line.'].join('\n'),
  );

  assert.equal(found.length, 1);
  assert.equal(found[0].line, 4);
});

// --- it must not flag prose ------------------------------------------------
//
// Every case below is text that really does appear in this repository's
// specifications. Each one mentions identifiers in bold, and each one is not
// a declaration. A guard that failed here would get disabled, which is the
// same outcome as having no guard.

test('does not flag a bold range in prose', () => {
  // This exact line is in SPEC-009 Annex B.2, and it is the case that made the
  // first version of the guard unusable.
  const found = findUnparseableDeclarations(
    '- **RF-W28–RF-W34** depend on a durable store.',
  );

  assert.deepEqual(found, []);
});

test('does not flag a bold list of identifiers followed by a parenthetical', () => {
  const found = findUnparseableDeclarations(
    '- **RF-V12** (and RF-V13) are covered by the indexer suite.',
  );

  assert.deepEqual(found, []);
});

test('does not flag bold text that is not an identifier', () => {
  const found = findUnparseableDeclarations(
    '- **MUST** be reconstructed as the canonical bytecode of the covenant.',
  );

  assert.deepEqual(found, []);
});

test('does not flag a declaration buried in a paragraph', () => {
  // Only list items are declarations. A requirement written as running prose
  // is a different problem, and this guard does not claim to find it.
  const found = findUnparseableDeclarations(
    'The following applies: **RF-O08a** (Ubiquity): never a fallback.',
  );

  assert.deepEqual(found, []);
});

// --- the two tools must not disagree ---------------------------------------

test('accepts every declaration the real specifications contain', () => {
  // If this fails, some specification in spec/ is shaped in a way the
  // inventory cannot read, and requirements.json is losing a requirement.
  const specDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'spec');
  const files = readdirSync(specDir).filter((f) => f.endsWith('.md'));

  assert.ok(files.length > 0, 'no specifications found to check');

  for (const file of files) {
    const unparseable = findUnparseableDeclarations(
      readFileSync(join(specDir, file), 'utf8'),
    );
    assert.deepEqual(
      unparseable.map((u) => `${file}:${u.line} ${u.identifier}`),
      [],
      `${file} has a declaration the inventory cannot parse`,
    );
  }
});

test('the guard and the parser agree on what is a declaration', () => {
  // The guard exists to catch what the parser skips. If a line parses and is
  // also flagged, or parses and is not flagged, one of the two is wrong. This
  // is the property that lets check-specs trust the shared module.
  const parseable = [
    '- **RF-V12** (Security): an implementation **MUST** do the thing.',
    '* **RF-O821** (Ubiquity): another one, with an asterisk bullet.',
    '  - **RF-W55** (Security): indented list item.',
    '- **RF-C03**\t(Prohibition): a tab before the qualifier.',
  ];

  for (const line of parseable) {
    assert.ok(
      RF_DECLARATION.test(line),
      `the parser should accept: ${line}`,
    );
    assert.deepEqual(
      findUnparseableDeclarations(line),
      [],
      `the guard should not fight the parser over: ${line}`,
    );
  }
});

test('a CRLF checkout is read the same as an LF checkout', () => {
  // The inventory strips a trailing \r so that a Windows working tree yields
  // the same declarations. The guard has to, or it would fire on every line
  // of a CRLF file and bury the real failure.
  const line = '- **RF-V12** (Security): an implementation **MUST** do the thing.';

  assert.deepEqual(findUnparseableDeclarations(`${line}\r\n`), []);
  assert.deepEqual(
    findUnparseableDeclarations(`- **RF-O08a** (Ubiquity): bad.\r\n`),
    [{ line: 1, identifier: 'RF-O08a' }],
  );
});