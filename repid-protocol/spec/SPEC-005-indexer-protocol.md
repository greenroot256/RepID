# SPEC-005: Fact Recognition (RFC-006)

> **Scope of this document.** This specification is **normative**. It defines how a
> RepID fact is *recognized* from a Bitcoin Cash transaction, and what state a
> recognizer is *required* to retain to do so deterministically. It does **not**
> specify how that state is stored, served or operated; that is an
> implementation concern and lives in `repid-sdk` (see §8).

## 1. Context and Objective

Bitcoin Cash stores immutable facts. A **recognizer** reconstructs structured RepID
facts from the raw bytes of transactions. A recognizer does not run the Bitcoin
VM and does not validate signatures: it classifies a transaction by its *shape*
(output patterns, `OP_RETURN` tags and the retained state).

The distinction that governs this document:

```text
BCH + RepID protocol rules  -> validity      (the chain decides)
Recognizer                 -> discovery     (a shaped fact is reconstructed)
```

A recognizer reconstructing a fact is **not** an authority. If a recognizer and
the chain disagree about whether a transaction is valid, **the chain is right**,
and the recognizer is defective.

## 2. User Stories

- As a protocol consumer, I want to distinguish unambiguously between a valid
  RepID fact, an *invalid* RepID attempt, and a transaction that is not a RepID
  fact at all.
- As an independent implementer, I want the recognition rules to be complete
  enough that my implementation reaches the same conclusion as any other
  implementation given the same inputs and the same retained state.
- As a third party auditing a claim, I want every recognized fact to be
  traceable to a transaction identifier and to the rule that produced it.

## 3. Normative Language

The key words **MUST**, **MUST NOT**, **SHOULD** and **MAY** are to be
interpreted as in RFC 2119.

`valid: false` is a **first-class outcome**. It means: this transaction is
RepID-shaped and was submitted on-chain, but it violates a protocol rule. It
MUST be reported, never silently dropped, because the transaction exists and
silencing it would hide malicious or defective activity.

`null` is a different outcome: the transaction is not RepID-shaped at all.

## 4. Functional Requirements (EARS)

### 4.1 Ubiquitous recognition

- **RF-01** (Ubiquity): A recognizer MUST reconstruct structured facts from the
  raw bytes of a transaction, without running the Bitcoin VM and without
  relying on signature validation.
- **RF-02** (Undesired Behavior): If a transaction matches no known RepID shape,
  the recognizer MUST NOT emit any fact, and MUST NOT invent an interpretation.

### 4.2 Identity

- **RF-03** (Events): When an identity is minted, the recognizer MUST recognize
  an `IDENTITY_GENESIS` fact in either of two forms:
  - **vault form** — an output carrying an immutable NFT whose 20-byte
    commitment is the owner's `pkh` and which is locked to the identity vault
    covenant; the value of that output is the collateral, and a P2PKH change
    output back to the owner is present;
  - **legacy form** — an immutable NFT to P2PKH without collateral.
  The fact MUST carry the token category, the owner's `pkh`, and, in the vault
  form, the collateral. In the vault form the recognizer MUST register the
  vault outpoint so that later spends of it can be tracked (RF-09, RF-10).
- **RF-09** (Events): When a registered identity-vault outpoint is spent and the
  same category reappears in the covenant output, the recognizer MUST recognize
  an `IDENTITY_COLLATERAL_TOP_UP` fact and move the registration to the new
  outpoint. It MUST mark the fact invalid if the category or commitment do not
  match, or if the new collateral is lower than the registered collateral.
- **RF-10** (Events): When a registered identity-vault outpoint is spent and the
  category does not reappear in any output, the recognizer MUST recognize an
  `IDENTITY_BURNED` fact, remove the registration, and treat the identity as no
  longer valid.

> Recognition of a vault spend MUST be attempted **before** recognition of the
> genesis in the same transaction. A top-up and a vault genesis have the same
> shape; only the retained outpoint distinguishes them.

### 4.3 Interaction and rating

- **RF-04** (Events): When a Receipt is minted together with two Rating Rights
  (three outputs of the same category, with a commitment in the first that is
  empty or carries a 4-byte or 36-byte interaction context, SPEC-009 §9.2),
  the recognizer MUST recognize a `RECEIPT_GENESIS` fact and register the two
  Rating Right outpoints and the Receipt's own transaction identifier.
- **RF-23** (Events): When the first output's commitment carries the interaction
  context, the recognizer MUST include in the `RECEIPT_GENESIS` fact the
  `interactionCategory`, `roleA` and `roleB` bytes and — for the 36-byte form —
  the `contextHash`. It MUST NOT invent values when the commitment is empty, and
  it MUST keep unknown `category`/`role` values raw (tolerant reading, SPEC-009
  RF-W73).
- **RF-05** (Events): When a registered Rating Right is spent with an
  `OP_RETURN` carrying the `REPID_RATING1` tag, the recognizer MUST recognize a
  `RATING_ISSUED` fact carrying the rater (`raterPkh`), the ratee (`rateePkh`)
  and the score.
- **RF-06** (Undesired Behavior): If the score is outside the range declared in
  `protocol/constants.json` (`MIN_SCORE`–`MAX_SCORE`, currently 1–5), the
  recognizer MUST mark the fact invalid rather than ignore it.
- **RF-24** (Events): When a registered Rating Right is spent with `REPID_RATING2`
  (SPEC-009 §4.2), the recognizer MUST recognize a `RATING_ISSUED` fact carrying
  the rater, the ratee, the score **and** the 32-byte `commentHash`; with
  `REPID_RATING1` (without a hash) the `RATING_ISSUED` MUST be recognized
  without that field.
- **RF-25** (Events): When a wallet spends its own P2PKH UTXO with
  `REPID_RETRACT1` (SPEC-009 §4.5) referencing the transaction identifier of a
  Receipt, the recognizer MUST recognize a `RATING_RETRACTION` fact with the
  spender (`raterPkh`) and the referenced identifier, and MUST add that reference
  to the retracted set (RF-27) so that a repeated retraction of the same rating
  is detected (SPEC-004 RF-07). If the referenced rating does not exist or was
  not signed by the spender, the fact MUST be marked invalid.

### 4.4 Platform confirmation

- **RF-07** (Events): When an entity spends its own P2PKH UTXO with an
  `OP_RETURN` carrying the `REPID_PLATFORM1` tag and a reference to a Receipt
  transaction identifier, the recognizer MUST recognize a `PLATFORM_CONFIRMATION`
  fact with the confirmer's `pkh` and the referenced identifier.
- **RF-08** (Undesired Behavior): If a platform confirmation references a
  Receipt that is not in the recognizer's Receipt index, the fact MUST be marked
  invalid.
- **RF-26** (Undesired Behavior): If the confirming entity's `pkh` equals
  `partyA` or `partyB` of the referenced Receipt (self-corroboration, SPEC-003
  RF-10), the recognizer MUST mark the `PLATFORM_CONFIRMATION` invalid.

### 4.5 Trust

- **RF-11** (Events): When identity A spends its own P2PKH UTXO with an
  `OP_RETURN` carrying the `REPID_TRUST1` tag and B's `pkh` (20 bytes), the
  recognizer MUST recognize a `TRUST_LINK` fact with `trusterPkh` = A and
  `trustedPkh` = B. If A and B are the same `pkh`, the fact MUST be marked
  invalid.

### 4.6 Retained state

- **RF-12** (Ubiquity): To recognize the facts above, a recognizer MUST be able
  to retain, and MUST be able to reconstruct after a process restart:
  1. the live Rating Right outpoints that have not yet been spent as ratings;
  2. the transaction identifiers of recognized Receipts;
  3. the registered identity-vault outpoints, with their collateral;
  4. the recognized interaction context of each Receipt, when present (RF-23);
  5. the set of rating references that have already been retracted (RF-27).
- **RF-27** (Ubiquity): The recognizer MUST retain — and reconstruct after a
  restart — the set of `RATING_RETRACTION` references so that a repeated
  retraction of the same rating is deterministic (SPEC-004 RF-07). Each entry
  MUST remain valid for the rating it points to, regardless of later facts.
- **RF-13** (Undesired Behavior): A spent Rating Right MUST be removed from the
  retained set when its rating is recognized, so that the same spend can never
  yield two ratings.

> **What RF-12 constrains.** The protocol constrains *what* must be retained and
> *why* each entry is needed; it deliberately does **not** constrain the storage
> engine. A recognizer MAY keep this state in memory, in a file, or in a
> database, provided that it can reconstruct it after a restart.

## 5. Ordering and Determinism

Given the same transaction and the same retained state, two independent
recognizers MUST reach the same conclusion (`VALID`, `INVALID`, or no fact).

- `PLATFORM_CONFIRMATION` is validated against the Receipt index (RF-08), so
  **order of appearance matters**. This is a deliberate, documented restriction,
  not an implementation detail. A recognizer processing a block range
  out of order MUST either re-validate pending confirmations or report them
  invalid.
- `IDENTITY_COLLATERAL_TOP_UP` and `IDENTITY_BURNED` depend on a prior vault
  registration (RF-09, RF-10), so the same restriction applies to vault spends.
- `RATING_RETRACTION` is validated against the ratings already recognized
  (RF-25) and against the retracted set (RF-27), so the same restriction applies
  to retractions.

## 6. Implementation Notes for CashTokens and CashScript

These are byte-order and library behaviours that independent implementers hit
repeatedly. They are recorded here because the protocol is otherwise ambiguous
without them.

- A CashTokens genesis transaction MUST spend an outpoint whose `vout` is `0`;
  otherwise the transaction is invalid at the consensus level, not at the
  covenant level.
- Inside a CashScript covenant, `tokenCategory` returns bytes in **reversed
  display order**.
- The decoder's `outpointTransactionHash` already arrives in display order and
  is **not** reversed. This is the opposite case of the previous rule; do not
  conflate them.
- An `OP_RETURN` helper that accepts strings treats them as UTF-8 unless they
  are explicitly prefixed with `0x`.

### Tooling limitations that must not be read as coverage

- `MockNetworkProvider` does **not** execute the Bitcoin VM and does not
  validate signatures or scripts. A successful
  `sendRawTransaction` is **not** evidence that a covenant is correct.
- `debug()` rejects transactions that use a custom `Unlocker` before evaluating
  them, so P2PKH "impostor" cases remain **inconclusive** with the available
  tooling. No coverage is claimed for them.
- The `fingerprint` field that `cashc` writes into a contract artifact is
  **not** a conformance anchor. Measured: changing
  `require(tx.outputs.length == 2)` to `== 3` altered the compiled bytecode, the
  embedded source and the debug bytecode, while the fingerprint stayed
  identical. An implementation MUST establish covenant conformance by
  recompiling and comparing the full artifact, never by comparing fingerprints.

## 7. Deliberate Edge Case

A Rating Right spent **without** a RepID `OP_RETURN` is **not** recognized as a
fact, and the outpoint remains alive in the retained set. The recognizer
recognizes complete shapes, not partial spends.

The same **complete-shape** rule applies to malformed rating payloads: an
`OP_RETURN` built with a valid tag but the wrong chunk count or chunk length is
**not** a fact (SPEC-009 RF-W64/RF-W65), while an out-of-range score **is** a
fact marked `valid: false` (RF-06).

Supporting that case would require tracking spends that carry no payload. It is
**out of scope** (see §9).

## 8. Boundary: what belongs to `repid-sdk`

| Concern | Owner |
|---|---|
| Which transaction shapes are facts, and when they are invalid | **This document** (normative) |
| Which state must be retained, and why | **This document** (RF-12) |
| Storage engine, durability, snapshotting | `repid-sdk` |
| Serving queries, transport, pagination | `repid-sdk` |
| Reputation, Confidence Index, any aggregate score | Application layer, not the protocol |

The recognizer MUST NOT be required by any application in order for a
protocol-level operation to be valid. An indexer is infrastructure; it is not
the authority that makes a fact valid.

## 9. Out of Scope

- Executing or validating the Bitcoin VM.
- Aggregated reputation, weighting, composite scores, trust propagation or
  recency. Interpretation is a separate layer and is explicitly not part of
  this protocol (see `SPEC-008` §7).
- Detecting Rating Right spends without an `OP_RETURN` (§7).
- Resolving the `pkh → Identity` link, which is off-chain.
- Indexing tokens or NFTs other than RepID's.
- Choosing a persistence engine.

## 10. Acceptance Criteria

- [x] Identity recognition covered: `IDENTITY_GENESIS` (legacy and vault forms),
      `IDENTITY_COLLATERAL_TOP_UP` and `IDENTITY_BURNED`, including relocation of
      the outpoint registration.
- [x] Remaining recognized facts covered: `RECEIPT_GENESIS`, `RATING_ISSUED`,
      `PLATFORM_CONFIRMATION`, `TRUST_LINK`.
- [x] **Lote 2 — executed:** `RATING_RETRACTION` (RF-25), the Receipt
      interaction context (RF-23/RF-27), the `REPID_RATING2` `commentHash`
      (RF-24) and self-corroboration invalidation (RF-26) are covered by the
      conformance vectors of task E (`repid-sdk/test/b3_0_4_0_vectors.test.ts`,
      RF-W64..W76, executed 2026-10-07) and the burn-delay VM tests
      (`conformance/identity-vault-burn-delay.test.mjs`).
- [x] `valid: false` produced for out-of-range scores (RF-06), for confirmations
      of unknown Receipts (RF-08) and for self-trust (RF-11).
- [x] `null` produced for transactions unrelated to RepID (RF-02) and for a
      P2PKH spend after a burn.
- [ ] **RF-12 persistence and RF-13 consumption have no automated coverage.**
      The removed mock-based unit tests covered the state transitions through
      `MockNetworkProvider`, which never ran the VM, so VM-level evidence never
      existed in the test suite. This is a known, declared gap, not a pass.
