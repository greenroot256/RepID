# SPEC-005: Indexer Protocol (RFC-006)

## 1. Context and Objective

The Indexer is RepID's interpretation layer: it reconstructs structured facts from the raw hex of BCH transactions and exposes them in a readable format for applications and people. The blockchain stores immutable facts; the Indexer interprets them **off-chain** (`constitution.md`, Article 1). It does not run the Bitcoin VM nor validate signatures: it recognizes facts by the *shape* of the transaction (output patterns, `OP_RETURN` tags, state tracking).

The protocol defines what is recognized as a fact, how each fact is validated, and how the index keeps the state that the chain alone does not retain (for example, which Rating Rights remain alive and which Receipts exist).

## 2. User Stories

- As an ecosystem observer, I want to see identity, interaction, rating and platform-confirmation facts in a structured and verifiable format, instead of raw hex transactions.
- As a protocol consumer, I want to unambiguously distinguish a valid fact from an invalid one, and know when a transaction is simply not a RepID fact.
- As an Indexer operator, I want the tracking state to survive process restarts, so I do not lose the traceability of "who already rated".

## 3. Functional Requirements (EARS Syntax)

- **RF-01** (Ubiquity): The system must reconstruct structured facts from the raw hex of transactions, without running the Bitcoin VM or relying on signature validation.
- **RF-02** (Events): When an identity is minted — **vault** form (an output with an immutable NFT of 20-byte `ownerPkh` commitment locked to the covenant, whose value is the collateral, plus a P2PKH change back to the owner) or **legacy** form (NFT to P2PKH, without collateral) — the system must recognize an `IDENTITY_GENESIS` fact with its category, the owner's pkh and the collateral (vault form). In the vault form it must register the covenant outpoint for later tracking.
- **RF-03** (Events): When a Receipt is minted together with two Rating Rights (3 outputs of the same category, empty commitment in the first one), the system must recognize a `RECEIPT_GENESIS` fact and register the two Rating Right outpoints and the Receipt's txid for later tracking.
- **RF-04** (Events): When a tracked Rating Right is spent with an `OP_RETURN` carrying the `REPID_RATING1` tag, the system must recognize a `RATING_ISSUED` fact identifying the rater (`raterPkh`), the ratee (`rateePkh`) and the score.
- **RF-05** (Undesired Behavior): If the score is outside the 1–5 range, then the system must mark the fact as invalid (recognize it but not silently ignore it).
- **RF-06** (Events): When a validating entity spends its own P2PKH UTXO with an `OP_RETURN` carrying the `REPID_PLATFORM1` tag and a reference to a Receipt txid, the system must recognize a `PLATFORM_CONFIRMATION` fact with the confirmer's pkh and the referenced txid.
- **RF-07** (Undesired Behavior): If a platform confirmation references a Receipt that is not indexed, then the system must mark the fact as invalid.
- **RF-08** (Ubiquity): The system must persist the index state (live Rating Right outpoints and indexed Receipt txids) so it survives process restarts.
- **RF-09** (Undesired Behavior): If a transaction does not match any known RepID shape, then the system must not emit any fact (without inventing interpretations).
- **RF-10** (Events): When an identity A spends its own P2PKH UTXO with an `OP_RETURN` carrying the `REPID_TRUST1` tag and B's pkh (20 bytes), the system must recognize a `TRUST_LINK` fact with `trusterPkh` = A and `trustedPkh` = B; if A and B are the same pkh, it must mark the fact as invalid (SPEC-006 RF-02/RF-03).
- **RF-11** (Events): When a tracked identity-vault outpoint is spent and the category reappears in the covenant, the system must recognize an `IDENTITY_COLLATERAL_TOP_UP` fact and move the tracking to the new outpoint; it must mark the fact as invalid if the category/commitment do not match or if the new collateral is lower than the registered one.
- **RF-12** (Events): When a tracked identity-vault outpoint is spent and the category does not reappear in any output, the system must recognize an `IDENTITY_BURNED` fact, remove the tracking and consider the identity without validity.

## 4. Non-Functional Requirements

- Deterministic recognition: the same transaction always produces the same fact (or none).
- Zero execution: the Indexer decodes and classifies by shape; the cryptographic validity of a transaction is the chain's responsibility, not the Indexer's.
- Agnostic to order of appearance where possible: platform confirmation is only validated against already-indexed Receipts (RF-07), so order matters; it is documented as a deliberate restriction rather than hidden.
- Minimal prototype persistence: local JSON file (plan.md §5). **Production will use a real database (e.g. SQLite/Postgres) in a later cycle — direction confirmed** (Section A of `tasks.md`, TASK-028, 2026-09-10).

## 5. Edge Cases and Constraints

**Confirmed design decisions** (Section A / TASK-008 / TASK-016):
- Invalid facts are REPORTED with `valid: false` instead of being ignored: the transaction is real on the chain, and silencing it would hide malicious or defective activity.
- `PLATFORM_CONFIRMATION` validates against the Receipts index, not against a whitelist: if the referenced Receipt was never indexed, the fact is invalid (RF-07).
- Protocol tags (`REPID_RATING1`, `REPID_PLATFORM1`): distinguish RepID's `OP_RETURN`s from any other use on the same chain. The value has no cryptographic commitment; it is a convention.

**Tooling findings that must NOT be rediscovered** (operational memory, plan.md §3 and agents.md §7):
- CashToken genesis transactions require the spent outpoint to have `vout == 0`.
- `tokenCategory` inside a covenant returns the bytes in reversed display order.
- The decoder's `outpointTransactionHash` already comes in display order and is NOT reversed (the opposite case of the above).
- `addOpReturnOutput` treats strings as UTF-8 unless they are prefixed with `"0x"`.
- `MockNetworkProvider.sendRawTransaction` does not run the VM nor validate signatures: a successful send does not prove the script is correct.
- `debug()` rejects transactions with a custom Unlocker before evaluating them: the "impostor" tests with P2PKH remained inconclusive and are NOT claimed as coverage.

**Deliberate edge case:** a Rating Right spend *without* a RepID `OP_RETURN` is not recognized as a fact; the outpoint remains "alive" in the index. The Indexer recognizes complete shapes, not partial spends. Supporting that case would require tracking spends without a payload **and is out of scope: a limit confirmed as an explicit MVP decision** (Section A of `tasks.md`, TASK-028, 2026-09-10).

## 6. Out of Scope

- Executing or validating the Bitcoin VM (the Indexer decodes and classifies; it does not re-validate consensus).
- Aggregated reputation calculations (averages, weights, composite score) — the reputation interpretation layer is **another layer**. The prototype already includes a demo portion of that layer (page **Indexer**, `server/reputation.mjs` + `GET /api/reputation/:pkh/interpret`): **reputation** is the star average (invariant) and the **Confidence Index** is defined by this indexer choosing and weighting **on-chain signals** (SPEC-007: `collateral`, `tenure`, `confirmed`, `endorsements`, `ratings` with `enabled` + `weight`, the `antiSybil` toggle, and named saved configs in `GET/PUT/DELETE /api/interpret-configs` with the read-only «Sample» preset); the full algorithms (trust graph, propagation, recency) remain out of scope.
- Detecting Rating Right spends without `OP_RETURN` (see the deliberate edge case).
- Production database (JSON is the prototype's persistence; plan.md §5 defers the decision to production).
- Indexing tokens or NFTs other than RepID's.
- Computing the "pkh → Identity link" (RFC-001): the resolution between pkh and identity category is off-chain and belongs to a later layer.

## 7. Acceptance Criteria (Definition of Done)

- [x] Identity facts covered by real tests: `IDENTITY_GENESIS` (legacy + vault, 8 + 17 covenant / 1 + 5 indexer), top-up (RF-11, `IDENTITY_COLLATERAL_TOP_UP`) and burn (RF-12, `IDENTITY_BURNED`) with per-outpoint tracking relocation.
- [x] The remaining recognized facts covered by real tests: `RECEIPT_GENESIS` (8 + rating/confirmation setup), `RATING_ISSUED` and `PLATFORM_CONFIRMATION` (RFC-004 + TASK-016).
- [x] `valid: false` for scores outside the 1–5 range (RF-05; TASK-008), for confirmations of unknown Receipts (RF-07; TASK-016) and for self-trust (RF-10; TASK-018).
- [x] `null` for transactions unrelated to RepID (RF-09, test "returns null…") and for a P2PKH spend after the burn (the tracking had already been removed).
- [x] JSON persistence of Rating Rights, the Receipts index and identity tracking with reload in a new instance (RF-08; TASK-004/TASK-016/TASK-036).
- [x] Full suite green: `npx vitest run` → 128 tests, 0 failures (10 files). The indexer is packaged as `@repid/indexer` (`packages/indexer/`, own `test/` with covenant fixtures) and consumes the protocol constants from `@repid/protocol`.
- [ ] The code complies with `constitution.md`.