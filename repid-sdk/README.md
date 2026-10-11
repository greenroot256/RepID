# @repid/sdk

Recognize RepID protocol facts from raw Bitcoin Cash transaction hex, and retain
the state the specification requires in order to do so.

This is the reference implementation of the protocol. It is **not** the
specification.

## What this is, and what it is not

RepID keeps immutable facts on chain and leaves their interpretation off chain.
That split is what this package is built around, and it is worth being precise
about where the line falls:

| Concern | Where it lives |
| --- | --- |
| Fact shapes, wire format, recognition rules, on-chain invariants | the `repid-protocol` repository — normative |
| Recognizing a fact from a transaction | **this package** |
| Deciding what a set of facts *means* (reputation, score, ranking) | not this package |

So there is no reputation score, no weighting, no confidence index and no UI here,
by design. An application that needs those interprets the facts this package
returns. The protocol states the facts; the application draws conclusions.

## Install

```sh
npm install @repid/sdk
```

Requires Node 20.10 or later. The package is ESM only. The floor is 20.10
specifically because the normative JSON inputs are loaded with import attributes
(`with { type: 'json' }`), which earlier 20.x releases did not accept.

## Use

```ts
import { indexRawTransaction, createMemoryStore, PROTOCOL_VERSION } from '@repid/sdk';

const store = createMemoryStore();

// Feed transactions in any order you obtain them. The store is what makes
// order matter only where the protocol says it does.
for (const rawTxHex of blocks.flatMap((b) => b.transactions)) {
  const fact = indexRawTransaction(rawTxHex, store);
  if (fact) console.log(fact.type, fact.txid);
}

console.log(`read under RepID protocol ${PROTOCOL_VERSION}`);
```

`indexRawTransaction` returns the recognized fact, or `null` when the transaction
matches no RepID shape. It throws when the hex cannot be decoded at all, which is
deliberately different: a transaction you cannot read is not the same as a
transaction that is not a fact.

To persist across restarts, use the Node entry point, which keeps the same
interface:

```ts
import { indexRawTransaction } from '@repid/sdk';
import { createJsonFileStore } from '@repid/sdk/node';

const store = createJsonFileStore('./repid-state.json');
```

The core import graph touches no `node:` module, so it runs in a browser or a
worker unchanged. That is why the filesystem-backed store is a separate entry
point rather than a conditional import.

## The store is part of the contract

A `RepidStateStore` retains three things, because the recognition rules require
them: Rating Right outpoints, Receipt txids, and identity vault outpoints.

```ts
interface RepidStateStore {
  getRatingRight(outpoint: Outpoint): RatingRightRecord | undefined;
  trackRatingRight(outpoint: Outpoint, info: RatingRightInfo): void;
  consumeRatingRight(outpoint: Outpoint): void;
  getReceipt(txid: Txid): ReceiptRecord | undefined;
  trackReceipt(txid: Txid, record: ReceiptRecord): void;
  getIdentity(outpoint: Outpoint): IdentityRecord | undefined;
  trackIdentity(outpoint: Outpoint, record: IdentityRecord): void;
}
```

The interface is normative in effect but not in mechanism: the specification
requires that this state be retained, not that it live in a `Map`. Implement it
however you like. `trackRatingRight` takes the outpoint as the key and the rest of
the record separately, so a record cannot contradict the key it is filed under.

If you implement the store yourself, one requirement is easy to miss:
`consumeRatingRight` must be called whenever a Rating Right outpoint is spent,
**including when the score is out of range**. A Rating Right is single-use, and an
invalid rating burns it just as a valid one does. Forgetting this lets the same
outpoint be recognized as rated more than once.

## Facts

Seven types, as declared by the protocol and cross-checked at load time. If the
protocol ever declares a type this SDK does not implement, importing the package
throws instead of silently ignoring that type of transaction.

`IDENTITY_GENESIS` · `IDENTITY_COLLATERAL_TOP_UP` · `IDENTITY_BURNED` ·
`RECEIPT_GENESIS` · `RATING_ISSUED` · `PLATFORM_CONFIRMATION` · `TRUST_LINK`

An invalid attempt is still a fact. A rating outside 1–5 is emitted with
`valid: false` rather than discarded, because the evidence that someone tried is
itself a fact worth keeping.

The normative JSON Schema is shipped and exported, so you can validate facts in
your own process:

```ts
import schema from '@repid/sdk/protocol/schemas/repid-fact.schema.json' with { type: 'json' };
import constants from '@repid/sdk/protocol/constants.json' with { type: 'json' };
```

## Working on this repository

The protocol is the single source of truth. The normative files are not written
here; they are copied in and their hashes are recorded:

```sh
npm run sync:protocol     # copy the normative files, record their hashes
npm run check:drift       # fail if the copies no longer match the protocol
npm run check:all         # typecheck + drift + tests
```

`src/protocol/` and `test/fixtures/` are copies. Editing one by hand is a mistake
`check:drift` is designed to catch. Point the scripts at a protocol checkout with
`REPID_PROTOCOL_REPO` if it is not a sibling directory.

`dist/` is not committed, so it has to be built after every clone. That is what
the `prepare` script does: npm runs it automatically when this package is
installed as a `file:` dependency, which is how the demo repository consumes it
today. Without it, a consumer would get a linked SDK with no compiled output and
the failure would surface as an unresolved import rather than as a missing
build. `prepack` covers the same need for `npm pack` and `npm publish`.

When the protocol is not reachable, `check:drift` reports `SKIPPED` and never
claims agreement — an absent toolchain is not evidence. Use
`npm run check:drift:strict` (what CI does) to make an unreachable protocol a
failure rather than a skip.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the conventions.

## What the tests do and do not prove

The suite builds real transactions with CashScript and recognizes them, which
exercises the decoding, the recognition precedence and the state transitions.

It does **not** execute the Bitcoin VM. The test provider does not run covenant
scripts, validate signatures or enforce the rules the covenants encode. So a
passing suite is evidence about *recognition*, not about *consensus*: that this
code reads transactions the way the specification says, and nothing more.

Agreement with the VM has been established separately, by running the covenants
on a public test network. That evidence is recorded in the protocol repository,
not here, and it is not reproduced by these tests.

## Status

`0.1.0`, pre-release. The protocol is pre-release too, and reporting the number
without the status would invite the wrong conclusion. Promotion to `1.0.0` has
conditions, recorded in `protocol/protocol-version.json`.

## License

MIT. See [LICENSE](LICENSE).
