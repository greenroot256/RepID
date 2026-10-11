// The raw half of the real-chain conformance vectors.
//
// real-chain-facts.json records what the reference implementation concluded about
// a real Chipnet run. That conclusion is only worth as much as the bytes it came
// from, so the bytes are recorded too, in real-chain-txs.json, and this file
// establishes the links between them:
//
//   * the recorded txid is the one the bytes actually hash to, so the hex cannot
//     be swapped for a different transaction while keeping a plausible txid;
//   * the two fixtures describe the same set of transactions;
//   * each transaction is labelled with the fact type its counterpart in the
//     other fixture carries.
//
// What this file deliberately does NOT do is decode the transactions. The
// protocol repository has no transaction decoder, and inventing one here would be
// a second recognizer competing with the SDK's. Decoding, interpreting the bytes
// and checking them against the canonical covenants is the SDK's job, and it does
// so in test/real_chain_binding.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) =>
  JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));

const rawTxs = read('real-chain-txs.json');
const realFacts = read('real-chain-facts.json').facts;

const sha = (bytes) => createHash('sha256').update(bytes).digest();
const txidOf = (raw) => Buffer.from(sha(sha(raw))).reverse().toString('hex');

test('each recorded txid is the one its bytes hash to', () => {
  // Bitcoin (and therefore CashTokens) txid: double SHA-256 over the
  // serialization, byte-reversed for display. Checking it here is what makes
  // these vectors evidence rather than decoration: a hand-edited hex would fail.
  assert.equal(rawTxs.transactions.length, 5);
  for (const entry of rawTxs.transactions) {
    const raw = Buffer.from(entry.hex, 'hex');
    assert.equal(
      txidOf(raw),
      entry.txid,
      `${entry.txid} does not match the hash of its own bytes`,
    );
    assert.equal(raw.length, entry.bytes, `${entry.txid} byte count`);
  }
});

test('the raw transactions are well-formed lowercase hex', () => {
  for (const entry of rawTxs.transactions) {
    assert.match(entry.hex, /^[0-9a-f]+$/, `${entry.txid} hex`);
    assert.equal(entry.hex.length % 2, 0, `${entry.txid} hex has an odd length`);
    assert.match(entry.txid, /^[0-9a-f]{64}$/, `${entry.txid} txid`);
  }
});

test('the txid is unique across the vectors', () => {
  const ids = rawTxs.transactions.map((t) => t.txid);
  assert.equal(new Set(ids).size, ids.length);
});

test('the raw transactions and the recorded facts describe the same run', () => {
  // The two fixtures are two views of one run. If they ever drift apart, one of
  // them is describing a different set of transactions and at least one
  // conclusion drawn from it is unsupported.
  assert.deepEqual(
    rawTxs.transactions.map((t) => t.txid),
    realFacts.map((f) => f.txid),
  );
});

test('each transaction is labelled with the fact type it produced', () => {
  const byTxid = new Map(realFacts.map((f) => [f.txid, f.type]));
  for (const entry of rawTxs.transactions) {
    assert.equal(
      byTxid.get(entry.txid),
      entry.type,
      `${entry.txid} is labelled ${entry.type}`,
    );
  }
});

test('the vectors are stored in chain order', () => {
  // Not cosmetic. Replaying them in a different order changes the result: a
  // rating only resolves against a Rating Right that an earlier receipt genesis
  // put in the index, so the receipt must come before its ratings.
  const order = rawTxs.transactions.map((t) => t.type);
  const receiptAt = order.indexOf('RECEIPT_GENESIS');
  const ratingsAt = order.filter((type) => type === 'RATING_ISSUED');
  assert.ok(receiptAt >= 0, 'no receipt genesis in the vectors');
  assert.deepEqual(ratingsAt, ['RATING_ISSUED', 'RATING_ISSUED']);
  assert.ok(
    receiptAt < order.lastIndexOf('RATING_ISSUED'),
    'the receipt genesis must precede the ratings that spend its Rating Rights',
  );
  // Both identities are minted before the receipt, since the receipt's Rating
  // Rights name parties that must already exist.
  assert.ok(receiptAt > order.lastIndexOf('IDENTITY_GENESIS'));
});

test('provenance is recorded for both fixtures', () => {
  for (const fixture of [rawTxs, { provenance: read('real-chain-facts.json').provenance }]) {
    assert.equal(fixture.provenance.network, 'chipnet');
    assert.ok(fixture.provenance.source.length > 0);
  }
});
