# @repid/indexer

RepID indexer: reconstructs structured **facts** from raw BCH transaction hex, using
libauth's `decodeTransactionBCH` (CashTokens-aware). It does not run the Bitcoin VM
nor validate signatures: it recognizes the transaction *shape* and extracts data
(`constitution.md`, Article 1 — the chain stores facts, interpretation stays off-chain).

This package is the **fact-recognition core** of RepID (RFC-006 / SPEC-005). It depends
on `@repid/protocol` for the protocol constants (OP_RETURN tags, score range, fact types)
and `@bitauth/libauth` for transaction decoding. It has no knowledge of covenants,
wallets or the demo server — it can be extracted and consumed by any RepID implementation.

## Installation

```bash
npm install @repid/indexer
```

## Usage

```js
import { indexRawTransaction, createMemoryStore, createJsonFileStore } from '@repid/indexer';

const store = createMemoryStore(); // or createJsonFileStore('./indexer-state.json')

const fact = indexRawTransaction(rawTxHex, store);
// -> { type: 'RATING_ISSUED', txid, spentOutpoint, raterPkh, rateePkh, score, valid }
// or null if the transaction matches no known RepID shape.
```

### Recognized facts

- `IDENTITY_GENESIS` (legacy NFT-to-P2PKH and vault-with-collateral forms)
- `RECEIPT_GENESIS` (Receipt NFT + two Rating Rights)
- `RATING_ISSUED` (single-use Rating Right spend + `OP_RETURN` score 1–5)
- `PLATFORM_CONFIRMATION` (validator P2PKH spend referencing a Receipt txid)
- `TRUST_LINK` (unilateral A→B trust declaration)
- `IDENTITY_COLLATERAL_TOP_UP` / `IDENTITY_BURNED` (vault outpoint spends)

Invalid shapes (score out of range, confirmation of unknown Receipt, self-trust) are
**reported** with `valid: false` rather than silently ignored; unrelated transactions
return `null`.

### Stores

- `createMemoryStore()` — in-memory index (Rating Right outpoints, Receipt txids,
  identity-vault outpoints). Use when you do not need to survive restarts.
- `createJsonFileStore(filePath)` — persists the same state to a local JSON file so a
  restarted process keeps tracing "who already rated" and "which Receipts exist".

## Tests

The package test suite lives in `test/` and is fully self-contained (the covenant
artifacts used to build sample transactions are committed under `test/fixtures/`):

```bash
npm test            # inside the package
npx vitest run      # from anywhere in the workspace
```

A note on the fixtures: `test/fixtures/*.json` are compiled copies of the reference
CashScript covenants (`identity_genesis`, `identity_vault`, `receipt_genesis`). If you
regenerate those contracts in the reference repository, re-copy the fresh artifacts here
before re-running the tests — this keeps the indexer package standalone.

## Scope

This is **not** the reputation interpretation layer. Aggregation, weighting, the
Confidence Index (SPEC-007) and any value judgment are a later, separate layer. This
package only reconstructs facts.