# SPEC-008: RepID Protocol — Formal Specification (Normative Core and Conformance)

> **Status**: normative core of the protocol. It prevails over SPEC-001 through SPEC-007 in case of conflict; those specs remain as *rationale* per feature. `constitution.md` prevails over any spec (Article 10). The byte-level contract of `OP_RETURN` facts and the recognition algorithm are stated normatively in **SPEC-009**, which complements §5 of this spec (and ranks below it: `constitution.md` > SPEC-008 > SPEC-009 > SPEC-001..007).
>
> **Nature**: this spec describes the **RepID protocol**, not an application. Any implementation that produces the on-chain artifacts of §4 and recognizes the facts of §3 according to §5 is conformant, regardless of the language, interface or network it runs on. The application in this repository is a **reference implementation** (Annex A, non-normative).
>
> **Vocabulary**: the requirements use EARS syntax (Ubiquity, Events, Undesired Behavior, Options, State). The requirements are **normative** insofar as they describe what the protocol demands; sections marked *non-normative* are context and do not create conformity obligations.

## 1. Context and Objective (Principles and Scope)

RepID is a decentralized reputation protocol on Bitcoin Cash that separates **immutable on-chain facts** from **off-chain interpretation**. The chain records what happened and who authorized it; no value judgment (reputation, trust, score) is part of the protocol.

Objective: define RepID's entities, events, cryptographic/on-chain rules, verification, interpretation limits, security and interoperability rules, so that an independent implementation can be validated against this spec.

### 1.1 Principles

- **P1 — On-chain facts, off-chain interpretation.** Every protocol fact is a verifiable on-chain artifact; every valuation is the local interpretation of an indexer or application (Constitution, Article 1).
- **P2 — No central authority.** No entity issues, approves or revokes identities or ratings; validity is deduced from the chain.
- **P3 — Fact immutability.** An emitted fact is not rewritten. Entities can *lose validity* (e.g., a burned identity) without the historical fact disappearing.
- **P4 — Explicit authorization.** Every spend of value or of a right requires the signature of whoever controls it; bilateral operations require a joint signature.
- **P5 — Simplicity.** The protocol uses the native guarantees of UTXOs/CashTokens (single spend, genesis from an outpoint with `vout 0`) before a dedicated covenant (Constitution, Article 2).
- **P6 — No mandatory score.** The protocol defines neither a reputation algorithm nor a normative trust value.

### 1.2 Requirements (EARS)

- **RF-P01** (Ubiquity): The protocol must separate on-chain facts from any reputation interpretation, so that no interpretation modifies a fact or its validity.
- **RF-P02** (Ubiquity): The protocol must not depend on any central authority to issue, validate or revoke identities, ratings or trust declarations.
- **RF-P03** (Ubiquity): The protocol must require cryptographic authorization (signature) from the party that controls a UTXO in order to spend it.
- **RF-P04** (Prohibition): The protocol must not define as mandatory any score, weighted average, reputation algorithm or trust threshold.
- **RF-P05** (State): As long as a fact is not invalidated by an explicit rule, the protocol must treat it as an existing fact, even if its interpretation is unfavorable.

### 1.3 Scope

**In scope**: identity and collateral; interaction (off-chain metadata); interaction receipt; rating rights; rating; platform validation; trust link; fact recognition/indexing; conformance rules.

**Out** (non-normative for the protocol): reputation and trust algorithms; collusion/farming detection; anti-sybil policies; user interfaces; persistence; deployment network; resolution of the `pkh → Identity` link.

## 2. Protocol Model

Entities and relationships. `pkh` identifiers are 20-byte public-key hashes; `category` is a CashToken's category (32 bytes).

| Entity | Nature | On-chain anchor | Associated data |
|---|---|---|---|
| **Identity** | Immutable NFT + collateral | `IdentityVault` covenant UTXO (or NFT to P2PKH in legacy form) | `identityCategory`, `ownerPkh`, `collateral` |
| **Interaction** | Application metadata | None (off-chain) | roles, `partyAPkh`, `partyBPkh`, `protocolRef` |
| **Receipt** | Immutable NFT | Output 0 of the receipt's genesis | `receiptCategory`, `receiptOwnerPkh` (= `partyA`) |
| **Rating Right** | Single-use NFT | Outputs 1 and 2 of the genesis | `ownerPkh`, `ratesPkh` (the counterparty) |
| **Rating** | Fact (spend + `OP_RETURN`) | Transaction that spends a Rating Right | `raterPkh`, `rateePkh`, `score` |
| **Platform validation** | Fact (spend + `OP_RETURN`) | Validator's P2PKH transaction | `platformPkh`, `receiptTxid` |
| **Trust Link** | Fact (spend + `OP_RETURN`) | Declarant's P2PKH transaction | `trusterPkh`, `trustedPkh` |

### 2.1 Relationships and cardinalities

- An **Interaction** references exactly **two** distinct parties with an explicit role (`partyA`, `partyB`).
- A **Receipt** corresponds to exactly one interaction and fixes exactly **two** parties (`partyA` = receipt holder; `partyB`).
- A Receipt originates exactly **two Rating Rights**: one from `partyA` rating `partyB`, and one from `partyB` rating `partyA` (cross relationship).
- A **Rating Right** produces **at most one Rating** (its spend burns it).
- An **Identity** can receive and emit N Ratings, N Validations and N Trust Links; there is no protocol limit on quantity.
- A **Trust Link** is unilateral `A → B` and requires neither B's consent nor B's identity; it does not enable rating.
- A **platform validation** references a Receipt's txid and does not modify it.

### 2.2 Requirements (EARS)

- **RF-M01** (Ubiquity): The protocol must model an interaction with exactly two distinct parties, each with an explicit role.
- **RF-M02** (Ubiquity): The protocol must issue exactly two Rating Rights per Receipt, each locked to one party and carrying the counterparty's pkh in its commitment.
- **RF-M03** (Ubiquity): The protocol must associate the identity with a 20-byte `ownerPkh` readable on-chain.
- **RF-M04** (Ubiquity): The protocol must treat the Trust Link as a unilateral declaration fact, without Rating Rights or automatic reciprocity.
- **RF-M05** (Ubiquity): The protocol must treat the platform validation as an independent fact that references — without altering it — the validated Receipt.

## 3. Protocol Events

The protocol defines **seven** fact types. A fact is a structured object reconstructed from a transaction; its fields and their types are normative.

### 3.1 Normative events table

| # | `type` | Meaning | Fields |
|---|---|---|---|
| E1 | `IDENTITY_GENESIS` | An identity was minted | `txid`, `identityCategory`, `ownerPkh`; in vault form also `collateral` (string), `identityOutpoint` |
| E2 | `IDENTITY_COLLATERAL_TOP_UP` | An identity's collateral was increased | `txid`, `identityCategory`, `ownerPkh`, `spentOutpoint`, `previousCollateral`, `collateral`, `valid` |
| E3 | `IDENTITY_BURNED` | An identity was burned | `txid`, `identityCategory`, `ownerPkh`, `spentOutpoint`, `valid` |
| E4 | `RECEIPT_GENESIS` | A receipt and its two Rating Rights were minted | `txid`, `receiptCategory`, `receiptOwnerPkh`, `ratingRights[]` = `{outpoint, ownerPkh, ratesPkh}` ×2 |
| E5 | `RATING_ISSUED` | A rating was issued | `txid`, `spentOutpoint`, `raterPkh`, `rateePkh`, `score`, `valid` |
| E6 | `PLATFORM_CONFIRMATION` | A platform corroborated an interaction | `txid`, `platformPkh`, `receiptTxid`, `valid` |
| E7 | `TRUST_LINK` | A declared trust in B | `txid`, `trusterPkh`, `trustedPkh`, `valid` |

### 3.2 Semantics and relationships

- E1 establishes the existence of an identity and its owner. Without E1 there is no protocol-valid identity.
- E2 and E3 only exist with respect to a previously tracked identity (E1 in vault form); they are mutually exclusive in the same vault spend.
- E4 establishes a receipt and, with it, two rating rights; it is the only event that creates Rating Rights.
- E5 only exists if it spends a Rating Right created by E4; it relates `raterPkh` (right holder) to `rateePkh` (counterparty of that Rating Right).
- E6 references a receipt by txid; its validity depends on the receipt (E4) being already indexed.
- E7 is independent of everything above; it requires no prior identity or interaction.
- Every event carries the `txid` of the transaction that originates it.

### 3.3 Requirements (EARS)

- **RF-E01** (Events): When an identity mint is recognized, the system must emit an `IDENTITY_GENESIS` fact with `identityCategory` and `ownerPkh`, and with `collateral` and `identityOutpoint` in vault form.
- **RF-E02** (Events): When a collateral increase is recognized, the system must emit an `IDENTITY_COLLATERAL_TOP_UP` fact with `previousCollateral`, `collateral` and `valid`.
- **RF-E03** (Events): When an identity burn is recognized, the system must emit an `IDENTITY_BURNED` fact with `identityCategory`, `ownerPkh` and `spentOutpoint`.
- **RF-E04** (Events): When a receipt mint is recognized, the system must emit a `RECEIPT_GENESIS` fact with `receiptCategory`, `receiptOwnerPkh` and the two `ratingRights` (`outpoint`, `ownerPkh`, `ratesPkh`).
- **RF-E05** (Events): When a rating is recognized, the system must emit a `RATING_ISSUED` fact with `spentOutpoint`, `raterPkh`, `rateePkh` and `score`.
- **RF-E06** (Events): When a platform validation is recognized, the system must emit a `PLATFORM_CONFIRMATION` fact with `platformPkh`, `receiptTxid` and `valid`.
- **RF-E07** (Events): When a trust link is recognized, the system must emit a `TRUST_LINK` fact with `trusterPkh`, `trustedPkh` and `valid`.
- **RF-E08** (Ubiquity): Every fact must include the `txid` of the transaction that originates it.
- **RF-E09** (Events): When a fact admits the validity distinction, the system must expose the `valid` field (boolean) without omitting the fact.

## 4. On-Chain Rules (Invariants, Signatures and Mutability)

This section defines what **MUST** be recorded on BCH and the invariants that govern it. The ultimate compliance authority is the Bitcoin VM; the covenant, when present, makes them executable.

### 4.1 Token structure

- **RF-O01** (Ubiquity): The protocol must represent identities, receipts and Rating Rights as CashToken NFTs with `capability = none` (immutable) and `tokenAmount = 0` (no associated fungibles).
- **RF-O02** (Ubiquity): The protocol must use the spent outpoint's txid as the genesis category, per the CashTokens rule, and require that outpoint to come from `vout == 0`.

### 4.2 Identity and collateral

- **RF-O03** (Events): When an identity is issued in vault form, the system must lock the NFT to the covenant bytecode with `nftCommitment = ownerPkh` (20 bytes) and `value` equal to the initial collateral, strictly greater than zero.
- **RF-O04** (Ubiquity): The identity covenant must require the owner's signature (`hash160(pk) == ownerPkh` and `checkSig`) on all its spend paths.
- **RF-O05** (Ubiquity): The identity covenant must re-lock the NFT to itself, in output 0, with the same category and commitment; the collateral (`value`) must **never decrease** with respect to the spent value.
- **RF-O06** (Ubiquity): The identity covenant must allow burning the NFT without the category reappearing in any output, returning the balance to the owner's P2PKH.
- **RF-O07** (Ubiquity): When a P2PKH change output exists in a genesis or in a vault spend, it must not carry tokens of the operation's category.

### 4.3 Receipt

- **RF-O08** (Events): When a receipt is issued, the system must require the joint signature of both parties in the genesis transaction.
- **RF-O09** (Ubiquity): The receipt's genesis must contain exactly four outputs: receipt (output 0), `partyA`'s Rating Right (output 1), `partyB`'s Rating Right (output 2) and P2PKH change to `partyA` (output 3), all four of the same category except the change, and all without fungibles.
- **RF-O10** (Ubiquity): The receipt must be locked to `partyA`'s P2PKH and have an empty `nftCommitment`; `partyA`'s Rating Right must have `commitment = partyB's pkh`, and `partyB`'s `commitment = partyA's pkh` (cross relationship).
- **RF-O11** (Ubiquity): The receipt's change output must be `partyA`'s P2PKH and carry no tokens of the issued category.

### 4.4 Rating

- **RF-O12** (Ubiquity): The protocol must represent each Rating Right as a single-use UTXO; its spend must implicitly burn the NFT, guaranteeing at most one rating per participant per receipt.
- **RF-O13** (Events): When a rating is issued, the system must include an `OP_RETURN` with the `REPID_RATING1` tag and an integer score in the 1–5 range.
- **RF-O14** (Undesired Behavior): If the score is outside the 1–5 range, then the fact must be recognized with `valid: false` (the emitted transaction is not considered a valid rating).

### 4.5 Platform validation and Trust Link

- **RF-O15** (Events): When a platform validates an interaction, the system must spend its own P2PKH UTXO and include an `OP_RETURN` with the `REPID_PLATFORM1` tag and the receipt's txid (32 bytes).
- **RF-O16** (Events): When A declares trust in B, the system must spend A's P2PKH UTXO and include an `OP_RETURN` with the `REPID_TRUST1` tag and B's pkh (20 bytes).
- **RF-O17** (Undesired Behavior): If a Trust Link declares trust about its own `trusterPkh` (self-trust), then the fact must be recognized with `valid: false`.

### 4.6 Mutability

- **RF-O18** (Ubiquity): Identity, receipt and Rating Right NFTs must not be mutable nor re-mintable; the category, once created, must not be re-issued.
- **RF-O19** (Ubiquity): An on-chain fact must not be modifiable nor deletable; only new facts can be issued (e.g. burning an identity does not erase its genesis).
- **RF-O20** (Prohibition): No on-chain rule must encode a value judgment (reputation, trust, weighting).

### 4.7 Byte notes (normative for implementers)

- Inside a CashScript covenant, `tokenCategory` is delivered in "internal" byte order; that representation must be considered when comparing it with on-chain categories.
- libauth's `decodeTransactionBCH` delivers `outpointTransactionHash` and `token.category` already in display order; they must not be reversed.
- `OP_RETURN` strings are encoded as UTF-8 except for the `"0x"` prefix, which indicates raw bytes.

## 5. Verification and Indexing

Indexing reconstructs facts from the raw hex of a transaction. It is a **deterministic, shape-based** recognition; it does not run the VM nor re-validate signatures (the network already did that). The byte-exact encoding of the `OP_RETURN` container, the per-tag payloads, the declarer derivation, the recognizer precedence and the state transitions are specified in **SPEC-009** (normative).

### 5.1 Definitions

- **Recognized fact**: a transaction whose shape matches a §3 type.
- **Valid fact**: a recognized fact that also satisfies the semantic rules of this spec (score range, known receipt, no self-trust, non-decreasing collateral).
- **Invalid fact**: a recognized fact that violates a semantic rule; it is reported with `valid: false`, never ignored.
- **Non-fact**: a transaction that matches no known shape; it produces no fact (`null`).
- **Verifiability**: a fact is cryptographically verifiable because the transaction that originates it exists on the chain and its txid anchors it; the indexer *recognizes* it, the chain *verifies* it.

### 5.2 Requirements (EARS)

- **RF-V01** (Ubiquity): The system must reconstruct facts from raw hex without running the VM or relying on signature validation.
- **RF-V02** (Ubiquity): Recognition must be deterministic: the same transaction must always produce the same fact, or none.
- **RF-V03** (Undesired Behavior): If a transaction matches no known shape, then the system must not emit any fact.
- **RF-V04** (State): The system must keep the state that the chain does not retain by itself: live Rating Right outpoints, indexed receipt txids and tracked vault outpoints.
- **RF-V05** (Events): When a tracked Rating Right is spent and the category does not reappear, the system must emit `RATING_ISSUED` (or `IDENTITY_BURNED` for the identity vault) and remove the corresponding tracking.
- **RF-V06** (Events): When a tracked vault outpoint is spent and the category reappears, the system must emit `IDENTITY_COLLATERAL_TOP_UP` and move the tracking to the new outpoint.
- **RF-V07** (State): The system must distinguish an identity vault spend before a genesis, because a top-up re-issues the same NFT with the same shape as a genesis and only outpoint tracking tells them apart.
- **RF-V08** (Undesired Behavior): If a platform validation references a receipt that is not indexed, then the system must mark the fact with `valid: false`.
- **RF-V09** (Undesired Behavior): If a collateral fact does not preserve the NFT category/commitment or the new collateral is lower than the registered one, then the system must mark it with `valid: false`.
- **RF-V10** (Ubiquity): The system must persist the index state so it survives process restarts.
- **RF-V11** (State): The system must accept that order of appearance matters: a validation can only be validated against already-indexed receipts (deliberate restriction, not hidden).

## 6. Reputation Interpretation

**Non-normative for the core.** This section sets the boundary: what an implementation may do without becoming protocol.

- **RF-R01** (Ubiquity): Reputation interpretation must operate exclusively on recognized facts and must not modify the facts or their validity.
- **RF-R02** (Prohibition): No interpretation must be a conformity requirement of the protocol; two implementations may compute different reputation over the same facts.
- **RF-R03** (Ubiquity): Interpretation must be able to distinguish valid from invalid facts and must not grant value to the latter.
- **RF-R04** (Options): Wherever an implementation defines a confidence index, it must be local, auditable down to the fact that originates it, and must not be presented as a protocol fact.

## 7. Security and Abuse Resistance

For each vector, this section distinguishes **what the protocol guarantees**, **what it delegates to interpretation** and **what is a known limitation**. Limitations are not hidden (Constitution, Article 4).

### 7.1 Vector matrix

| Vector | Protocol guarantee | Interpretation responsibility | Known limitation |
|---|---|---|---|
| **Sybil** | None on-chain: creating identities costs fees (and optionally collateral) | Weigh by identity/collateral (e.g. CI anti-sybil) | N identities can still be created |
| **Spam** | Only network cost (fees) | Filter/deprioritize by local criterion | No protocol rate limit |
| **Self-reputation** | Trust Link about oneself → `valid: false` | — | A colluding pair can mutually rate each other (not direct self-rating) |
| **Collusion** | Ratings require a receipt signed by both parties and a single Rating Right | Detection and weighting | A real interaction cannot be distinguished from a simulated one |
| **Reputation farming** | One rating per Rating Right (single-use UTXO) | Weigh by counterparty/recency/collateral | Nothing prevents multiple valued interactions |
| **Selective acceptance** | A non-existent receipt produces no facts | — | There is no on-chain recourse if a party refuses to sign |
| **Rating manipulation** | Score outside 1–5 → `valid: false`; fixed range | Judgment about the rating's intent | The protocol does not verify the score's truthfulness |

### 7.2 Requirements (EARS)

- **RF-S01** (Ubiquity): The protocol must prevent double rating per participant and per receipt through the Rating Right's single-spend semantics.
- **RF-S02** (Undesired Behavior): If a Trust Link is self-trust, the system must mark it invalid.
- **RF-S03** (Undesired Behavior): If a score is outside the 1–5 range, the system must mark it invalid.
- **RF-S04** (Prohibition): The protocol must not present any anti-sybil, anti-spam or anti-collusion mitigation as guaranteed if it depends on the interpretation layer.
- **RF-S05** (Ubiquity): The known limitations of §7.1 must be explicitly documented and must not be claimed as solved.

## 8. Interoperability and Extensibility

- **RF-I01** (Ubiquity): The protocol must use a readable, versionable tag space (`REPID_*`) to distinguish its `OP_RETURN`s from other uses of the chain.
- **RF-I02** (Ubiquity): The protocol must separate the **core** (identity, receipt, Rating Right, rating) from the **extensions** (platform validation, Trust Link), so that an implementation can adopt extensions without breaking the core.
- **RF-I03** (Options): Wherever an application contributes its own metadata, it must remain off-chain; only the resulting receipt is anchored on-chain.
- **RF-I04** (Ubiquity): The protocol must allow different applications and platforms to operate over the same facts without prior coordination, using the §3 schemas.
- **RF-I05** (Options): Wherever new mechanisms are added (new identities, new validations), they must be declared as extensions and must not alter the existing facts.

### 8.1 Core vs extensions

| Layer | Components |
|---|---|
| **Core** | Identity (`IDENTITY_GENESIS`, `TOP_UP`, `BURNED`), Receipt (`RECEIPT_GENESIS`), Rating Right + Rating (`RATING_ISSUED`) |
| **Extensions** | Platform validation (`PLATFORM_CONFIRMATION`), Trust Link (`TRUST_LINK`) |
| **Outside the protocol** | Reputation, confidence indices, anti-sybil, UI, persistence |

## 9. Conformance

### 9.1 Levels

- **Issuance conformity**: an implementation that produces on-chain artifacts conformant to §4.
- **Recognition conformity**: an implementation that recognizes facts conformant to §3 and §5.
- **Full conformity**: satisfies both.

### 9.2 Requirements (EARS)

- **RF-C01** (Ubiquity): An issuance-conformant implementation must produce the §4 artifacts with the invariants defined there.
- **RF-C02** (Ubiquity): A recognition-conformant implementation must emit the §3 facts with the fields defined there and apply the §5 validity semantics.
- **RF-C03** (Undesired Behavior): If a transaction is not a RepID fact, a conformant implementation must not emit any fact.
- **RF-C04** (Ubiquity): An implementation must not declare itself conformant if it introduces an on-chain value judgment or presents a known §7 limitation as a guarantee.
- **RF-C05** (Ubiquity): Conformity must be verified with real executable evidence (tests) mapped in Annex B, not with descriptions.
- **RF-C06** (Options): Wherever an implementation differs in non-normative layers (UI, persistence, network, reputation), that difference must not affect protocol conformity.

## Annex A — Reference Implementation (non-normative)

> Informational content. Describes the implementation of this repository; it creates no conformity obligations. Another implementation may differ in any of these aspects.

- **Contracts (CashScript 0.13.2)**: `contracts/identity_vault.cash` (`mint`/`increaseCollateral`/`burn`), `contracts/receipt_genesis.cash` (`mint` with joint signature), `contracts/identity_genesis.cash` (single-use legacy form).
- **Indexer**: `packages/indexer/src/repid-indexer.mjs` (published as `@repid/indexer`) — `indexRawTransaction(rawTxHex, store)`; in-memory (`createMemoryStore`) and JSON (`createJsonFileStore`) stores. Protocol constants and this spec live in `@repid/protocol` (`packages/protocol/`).
- **Interaction layer**: `interaction/repid-interaction.mjs` — `validateInteraction`, `buildInteraction`, `toReceiptParts` (RFC-002, off-chain).
- **Server**: `server/index.js` (Express) with 31 endpoints; among them identities (`POST/GET /api/identities`, `POST /api/identities/:pkh/collateral`, `POST /api/identities/:pkh/burn`), interactions, ratings, trust links, platform, `GET /api/facts`, `GET /api/indexer-view`, `GET /api/reputation/:pkh` and `/interpret`, `POST /api/transfer`, `POST /api/sweep`, and `POST /api/demo/run`.
- **Web console**: `server/public/` with four views: **Console**, **Sample app**, **Indexer**, **Identities** (minting with collateral, listing of active and burned, top-up and burn rebuilt from the ledger).
- **Dual mode**: `REPID_NETWORK=mock` (simulated) or `chipnet` (real network); on Chipnet every network operation runs in a separate child process.
- **Persistence**: `data/repid-state.json` and `data/wallet.json` (isolatable with `REPID_DATA_DIR`).

## Annex B — Glossary and Conformance Matrix

### B.1 Glossary

- **pkh**: hash160 (20 bytes) of a public key; identifies the controller of a UTXO.
- **Category (token category)**: 32-byte identifier of a CashToken; in genesis it is the spent outpoint's txid.
- **Commitment**: data field of the NFT; in identity = `ownerPkh`, in Rating Right = the counterparty's pkh.
- **Vault**: the covenant UTXO that holds the identity NFT and its collateral.
- **Fact**: structured object produced when a transaction is recognized.
- **Indexer**: the off-chain layer that reconstructs facts.
- **Collateral**: sats locked in the vault; they never decrease on-chain.

### B.2 RF → code → test matrix

| RF | Reference code | Backing test |
|---|---|---|
| RF-O03–RF-O07 | `contracts/identity_vault.cash` | `test/identity_vault.test.js` (17) |
| RF-O01–RF-O02, RF-E01, RF-M03, RF-V07 | `contracts/identity_vault.cash`, `packages/indexer/src/repid-indexer.mjs` | `test/identity_vault.test.js`, `test/identity_genesis.test.js` (8), `packages/indexer/test/identity_vault_indexer.test.js` (5) |
| RF-O08–RF-O11, RF-E04, RF-M02 | `contracts/receipt_genesis.cash`, `packages/indexer/src/repid-indexer.mjs` | `test/receipt_genesis.test.js` (10) |
| RF-O12–RF-O14, RF-E05, RF-S01, RF-S03 | `packages/indexer/src/repid-indexer.mjs` | `packages/indexer/test/issued_rating_and_indexer.test.js` (11) |
| RF-O15, RF-E06, RF-V08 | `packages/indexer/src/repid-indexer.mjs` | `packages/indexer/test/platform_confirmation.test.js` (4) |
| RF-O16–RF-O17, RF-E07, RF-S02 | `packages/indexer/src/repid-indexer.mjs` | `packages/indexer/test/trust_link.test.js` (3) |
| RF-E02, RF-E03, RF-V05, RF-V06, RF-V09 | `packages/indexer/src/repid-indexer.mjs` | `packages/indexer/test/identity_vault_indexer.test.js` (5) |
| RF-M01, RF-I03 | `interaction/repid-interaction.mjs` | `test/interaction.test.js` (9) |
| RF-R01–RF-R04 | `server/reputation.mjs` (not core) | `test/reputation.test.js` (20) |
| RF-V03, RF-V04, RF-V10, RF-V11, RF-C03 | `packages/indexer/src/repid-indexer.mjs`, `server/index.js` | `test/e2e_server.test.js` (41) |

**Honest coverage (Article 4)**: the boundary/negative RFs (absence of on-chain score, absence of central authority, §7 limitations) are validated by inspection and by the absence of code that violates them, not by automated test. `MockNetworkProvider` does not run the VM nor validate signatures; the "impostor" tests with P2PKH remain inconclusive (see `agents.md` §7). The strongest issuance evidence is the real Chipnet E2E (TASK-026, 11/11 PASS). The UI (Annex A) is verified manually via `docs/TESTING.md`; no automated UI coverage is claimed.

## Out of Scope

- Reputation, trust, weighting, propagation and recency algorithms.
- Collusion, farming, sybil or spam detection (interpretation layer).
- Resolution of the `pkh → Identity` link.
- Multi-party interactions (>2); multi-party receipts.
- Private-key recovery or identity revocation without burn.
- Disputes, interaction cancellation and ratings with free text.
- Production persistence and deployment network choice.

## Acceptance Criteria (Definition of Done)

- [x] The nine protocol sections (principles, model, events, on-chain rules, verification, reputation, security, interoperability, conformance) are specified.
- [x] The seven §3 events have a normative field schema, verified against `packages/indexer/src/repid-indexer.mjs`.
- [x] The §4 on-chain invariants are backed by the covenants and their real tests.
- [x] The facts/interpretation boundary is declared and the CI (SPEC-007) is marked as non-normative.
- [x] The RF → code → test matrix (Annex B) references real tests; the limits are explicitly declared.
- [x] SPEC-008 prevails over SPEC-001 through SPEC-007 (precedence note).
- [x] Full suite green: `npx vitest run` → 128 tests, 0 failures.
- [ ] The code complies with `constitution.md`.