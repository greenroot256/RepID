// Known-answer vectors for the byte-exact preimage behind commentHash
// (SPEC-004 RF-10/RF-11, SPEC-008 RF-O826, SPEC-009 §4.2 and Annex B.4).
//
// These hashes are never read by a covenant and never verified by the
// recognizer, so the conformance suite cannot exercise them through a decoder.
// They are plain SHA-256 computations over the layout the specifications
// declare, and this file pins that layout the same way chain-evidence pins
// real hex: a mispelled prefix, a truncated byte count or a forgotten
// normalization step produces a digest nothing on the other side can verify.
//
// The layout binds the utterance to the Receipt the rating belongs to by
// hashing that Receipt's on-chain `receiptCategory` (32 bytes) right after the
// prefix. The vector uses the real category of the 2026-09-27 Chipnet fixture
// (5f4c7226b4aa9d9e9dcbf9518e9bbed00e4e44306c2052ce2bd7fa25560b36b0), so the
// digest doubles as a real-data anchor rather than a hand-written example.
//
// Two values are read from protocol/constants.json so that a drift between the
// machine-readable file and this test is reported rather than silently
// reconciled:
//
//   * SALT_MIN_LENGTH / SALT_MAX_LENGTH — a salt outside 16..32 changes the
//     layout and is detectable before any vector is computed;
//   * receiptCommitment.preimage.prefixBytes — the contextHash has no published
//     preimage (decision P6), and this byte-count fact is the only context-hash
//     fact recorded: 'REPID-RCTX-V1' is 13 bytes, corrected from an earlier
//     12-byte claim. The guard stops a producer who copies the old number from
//     truncating the prefix it must reproduce.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { constants } from '../tools/validate.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex = (s) => Buffer.from(s, 'hex');
const utf8 = (s) => Buffer.from(s, 'utf8');
const ascii = (s) => Buffer.from(s, 'ascii');

test('the commentHash preimage vector reproduces (RF-10 layout)', () => {
  const prefix = ascii('REPID-CMT-V1');
  const receiptCategory = hex(
    '5f4c7226b4aa9d9e9dcbf9518e9bbed00e4e44306c2052ce2bd7fa25560b36b0',
  );
  const raterPkh = hex('0000000000000000000000000000000000000001');
  const saltLen = Uint8Array.of(16);
  const salt = hex('a1b2c3d4e5f60718293a4b5c6d7e8f90');
  const comment = utf8('Top rider, arrived on time');

  assert.equal(prefix.length, 12, 'REPID-CMT-V1 is 12 ASCII bytes');
  assert.equal(receiptCategory.length, 32, 'receiptCategory is 32 bytes');
  assert.equal(raterPkh.length, 20, 'raterPkh is 20 bytes');
  assert.equal(salt.length, 16, 'salt is 16 bytes (SALT_MIN_LENGTH)');

  const preimage = Buffer.concat([
    prefix,
    receiptCategory,
    raterPkh,
    saltLen,
    salt,
    comment,
  ]);
  assert.equal(preimage.length, 12 + 32 + 20 + 1 + 16 + 26, 'preimage byte count');
  assert.equal(
    preimage.toString('hex'),
    '52455049442d434d542d5631' +
      '5f4c7226b4aa9d9e9dcbf9518e9bbed00e4e44306c2052ce2bd7fa25560b36b0' +
      '0000000000000000000000000000000000000001' +
      '10' +
      'a1b2c3d4e5f60718293a4b5c6d7e8f90' +
      '546f702072696465722c2061727269766564206f6e2074696d65',
    'the layout is byte-exact and order-sensitive',
  );
  assert.equal(
    sha256(preimage),
    'b73e344beeac85c3136a7e5dc83feb869a9966bd5a3e9540150c29c6e16d4cf4',
    'digest must match SPEC-009 Annex B.4',
  );
});

test('the context prefix byte count is pinned (no published preimage)', () => {
  const rctx = ascii('REPID-RCTX-V1');
  assert.equal(rctx.length, 13, 'REPID-RCTX-V1 is 13 ASCII bytes');

  const declaration = constants.receiptCommitment.preimage;
  assert.equal(declaration.prefix, 'REPID-RCTX-V1');
  assert.equal(
    declaration.prefixBytes,
    13,
    "the recorded contextHash prefixBytes must be 13 — the contextHash has no " +
      'published preimage and this byte-count fact is all a producer can copy, ' +
      'so a regression to the old 12-byte claim must be reported',
  );
  assert.equal(ascii(declaration.prefix).length, declaration.prefixBytes);
});

test('the salt range in constants bounds the layout', () => {
  const preimage = constants.commentHash.preimage;
  assert.equal(preimage.prefix, 'REPID-CMT-V1');
  assert.equal(ascii(preimage.prefix).length, 12);
  assert.equal(preimage.RECEIPT_CATEGORY_LENGTH, 32);
  assert.ok(preimage.SALT_MIN_LENGTH >= 1, 'a zero-length salt would be no salt');
  assert.equal(preimage.SALT_MIN_LENGTH, 16);
  assert.equal(preimage.SALT_MAX_LENGTH, 32);
  assert.ok(
    preimage.SALT_MIN_LENGTH <= preimage.SALT_MAX_LENGTH,
    'min must not exceed max',
  );
});

test('UTF-8 NFC normalization is part of the KAT', () => {
  // é precomposed (NFC) vs decomposed (NFD) are different byte sequences but
  // must hash equal because RF-10 requires NFC normalization before hashing.
  // Without the normalize() step the digests would differ.
  const nfc = 'Top rider caf\u00e9 arrived';
  const nfd = 'Top rider cafe\u0301 arrived';
  assert.notEqual(utf8(nfc).toString('hex'), utf8(nfd).toString('hex'));

  const preimage = (comment) =>
    Buffer.concat([
      ascii('REPID-CMT-V1'),
      hex('5f4c7226b4aa9d9e9dcbf9518e9bbed00e4e44306c2052ce2bd7fa25560b36b0'),
      hex('0000000000000000000000000000000000000001'),
      Uint8Array.of(16),
      hex('a1b2c3d4e5f60718293a4b5c6d7e8f90'),
      utf8(comment.normalize('NFC')),
    ]);

  assert.equal(sha256(preimage(nfc)), sha256(preimage(nfd)));
});