# SPEC-008: RepID Protocol — Formal Specification (Normative Core and Conformance)

> **Status**: normative core of the protocol. It prevails over the other specifications in case of conflict; those specs remain as *rationale* per feature. `constitution.md` prevails over any spec (Article 10). The byte-level contract of `OP_RETURN` facts and the recognition algorithm are stated normatively in **SPEC-009**, which complements §5 of this spec and ranks below it. Precedence: `constitution.md` > SPEC-008 > SPEC-009 > the remaining specifications in this repository.
>
> **Not in this repository**: SPEC-002's off-chain metadata rules are included as
> specification; SPEC-007 (reputation and the Confidence Index) is **not**, because
> interpretation is not protocol. It lives with the application that implements it.
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

**In scope**: identity and collateral; interaction (off-chain metadata); interaction receipt; rating rights; rating; rating retraction; platform validation; trust link; fact recognition/indexing; conformance rules.

**Out** (non-normative for the protocol): reputation and trust algorithms; collusion/farming detection; anti-sybil policies; user interfaces; persistence; deployment network; resolution of the `pkh → Identity` link.

## 2. Protocol Model

Entities and relationships. `pkh` identifiers are 20-byte public-key hashes; `category` is a CashToken's category (32 bytes).

| Entity | Nature | On-chain anchor | Associated data |
|---|---|---|---|
| **Identity** | Immutable NFT + collateral | `IdentityVault` covenant UTXO (or NFT to P2PKH in legacy form) | `identityCategory`, `ownerPkh`, `collateral` |
| **Interaction** | Application metadata | None (off-chain) | roles, `partyAPkh`, `partyBPkh`, `protocolRef` |
| **Receipt** | Immutable NFT | Output 0 of the receipt's genesis | `receiptCategory`, `receiptOwnerPkh` (= `partyA`) |
| **Rating Right** | Single-use NFT | Outputs 1 and 2 of the genesis | `ownerPkh`, `ratesPkh` (the counterparty) |
| **Rating** | Fact (spend + `OP_RETURN`) | Transaction that spends a Rating Right | `raterPkh`, `rateePkh`, `score`, `commentHash`? |
| **Rating retraction** | Fact (spend + `OP_RETURN`) | Rater's P2PKH transaction | `raterPkh`, `receiptTxid` |
| **Platform validation** | Fact (spend + `OP_RETURN`) | Validator's P2PKH transaction | `platformPkh`, `receiptTxid` |
| **Trust Link** | Fact (spend + `OP_RETURN`) | Declarant's P2PKH transaction | `trusterPkh`, `trustedPkh` |

### 2.1 Relationships and cardinalities

- An **Interaction** references exactly **two** distinct parties with an explicit role (`partyA`, `partyB`).
- A **Receipt** corresponds to exactly one interaction and fixes exactly **two** parties (`partyA` = receipt holder; `partyB`).
- A Receipt originates exactly **two Rating Rights**: one from `partyA` rating `partyB`, and one from `partyB` rating `partyA` (cross relationship).
- A **Rating Right** produces **at most one Rating** (its spend burns it).
- A **Rating** can be retracted at most once, by the rater, keyed by the rating's Receipt txid; the retraction is a new fact (the original rating is never deleted).
- An **Identity** can receive and emit N Ratings, N Retractions, N Validations and N Trust Links; there is no protocol limit on quantity.
- A **Trust Link** is unilateral `A → B` and requires neither B's consent nor B's identity; it does not enable rating.
- A **platform validation** references a Receipt's txid and does not modify it.

### 2.2 Requirements (EARS)

- **RF-M01** (Ubiquity): The protocol must model an interaction with exactly two distinct parties, each with an explicit role.
- **RF-M02** (Ubiquity): The protocol must issue exactly two Rating Rights per Receipt, each locked to one party and carrying the counterparty's pkh in its commitment.
- **RF-M03** (Ubiquity): The protocol must associate the identity with a 20-byte `ownerPkh` readable on-chain.
- **RF-M04** (Ubiquity): The protocol must treat the Trust Link as a unilateral declaration fact, without Rating Rights or automatic reciprocity.
- **RF-M05** (Ubiquity): The protocol must treat the platform validation as an independent fact that references — without altering it — the validated Receipt.

## 3. Protocol Events

The protocol defines **eight** fact types. A fact is a structured object reconstructed from a transaction; its fields and their types are normative.

### 3.1 Normative events table

| # | `type` | Meaning | Fields |
|---|---|---|---|
| E1 | `IDENTITY_GENESIS` | An identity was minted | `txid`, `identityCategory`, `ownerPkh`; in vault form also `collateral` (string), `identityOutpoint` |
| E2 | `IDENTITY_COLLATERAL_TOP_UP` | An identity's collateral was increased | `txid`, `identityCategory`, `ownerPkh`, `spentOutpoint`, `previousCollateral`, `collateral`, `valid` |
| E3 | `IDENTITY_BURNED` | An identity was burned | `txid`, `identityCategory`, `ownerPkh`, `spentOutpoint`, `valid` |
| E4 | `RECEIPT_GENESIS` | A receipt and its two Rating Rights were minted | `txid`, `receiptCategory`, `receiptOwnerPkh`, `ratingRights[]` = `{outpoint, ownerPkh, ratesPkh}` ×2, `receiptContext`? = `{interactionCategory, roleA, roleB, contextHash?}` |
| E5 | `RATING_ISSUED` | A rating was issued | `txid`, `spentOutpoint`, `raterPkh`, `rateePkh`, `score`, `commentHash`?, `valid` |
| E6 | `PLATFORM_CONFIRMATION` | A platform corroborated an interaction | `txid`, `platformPkh`, `receiptTxid`, `valid` |
| E7 | `TRUST_LINK` | A declared trust in B | `txid`, `trusterPkh`, `trustedPkh`, `valid` |
| E8 | `RATING_RETRACTION` | A rater unilaterally retracted a rating | `txid`, `raterPkh`, `receiptTxid`, `valid` |

### 3.2 Semantics and relationships

- E1 establishes the existence of an identity and its owner. Without E1 there is no protocol-valid identity.
- E2 and E3 only exist with respect to a previously tracked identity (E1 in vault form); they are mutually exclusive in the same vault spend.
- E4 establishes a receipt and, with it, two rating rights; it is the only event that creates Rating Rights.
- E5 only exists if it spends a Rating Right created by E4; it relates `raterPkh` (right holder) to `rateePkh` (counterparty of that Rating Right). It may carry an optional `commentHash` when the spend used `REPID_RATING2`; the comment itself is never on-chain (SPEC-004 RF-09).
- E6 references a receipt by txid; its validity depends on the receipt (E4) being already indexed.
- E7 is independent of everything above; it requires no prior identity or interaction.
- E8 references an E5 by the txid of the Receipt that produced it. It is unilateral (only the rater can spend its own P2PKH UTXO with `REPID_RETRACT1`), a rating can be retracted at most once, and E8 never deletes the original E5: the chain records, it does not rescind.
- Every event carries the `txid` of the transaction that originates it.

### 3.3 Requirements (EARS)

- **RF-E01** (Events): When an identity mint is recognized, the system must emit an `IDENTITY_GENESIS` fact with `identityCategory` and `ownerPkh`, and with `collateral` and `identityOutpoint` in vault form.
- **RF-E02** (Events): When a collateral increase is recognized, the system must emit an `IDENTITY_COLLATERAL_TOP_UP` fact with `previousCollateral`, `collateral` and `valid`.
- **RF-E03** (Events): When an identity burn is recognized, the system must emit an `IDENTITY_BURNED` fact with `identityCategory`, `ownerPkh` and `spentOutpoint`.
- **RF-E04** (Events): When a receipt mint is recognized, the system must emit a `RECEIPT_GENESIS` fact with `receiptCategory`, `receiptOwnerPkh` and the two `ratingRights` (`outpoint`, `ownerPkh`, `ratesPkh`).
- **RF-E05** (Events): When a rating is recognized, the system must emit a `RATING_ISSUED` fact with `spentOutpoint`, `raterPkh`, `rateePkh` and `score`; when the spend used `REPID_RATING2`, it must also carry the `commentHash`.
- **RF-E06** (Events): When a platform validation is recognized, the system must emit a `PLATFORM_CONFIRMATION` fact with `platformPkh`, `receiptTxid` and `valid`.
- **RF-E07** (Events): When a trust link is recognized, the system must emit a `TRUST_LINK` fact with `trusterPkh`, `trustedPkh` and `valid`.
- **RF-E08** (Ubiquity): Every fact must include the `txid` of the transaction that originates it.
- **RF-E09** (Events): When a fact admits the validity distinction, the system must expose the `valid` field (boolean) without omitting the fact.
- **RF-E10** (Events): When a rating retraction is recognized, the system must emit a `RATING_RETRACTION` fact with `raterPkh`, `receiptTxid` and `valid`.
- **RF-E11** (Events): When a receipt is recognized with an interaction context commitment, the system must emit the `RECEIPT_GENESIS` fact with `receiptContext` = `{interactionCategory, roleA, roleB, contextHash?}`, keeping unknown `category`/`role` values raw.
- **RF-E12** (Events): When a rating retraction references a rating that does not exist, was not signed by the spender, or is already retracted, the system must emit the `RATING_RETRACTION` with `valid: false` and must not delete the original `RATING_ISSUED`.

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
- **RF-O831** (Ubiquity): The identity covenant's burn path must require the vault's `age` (CashScript `this.age`) to be at least `identityVault.minBurnDelayBlocks` (144, declared in `protocol/constants.json`) before the identity can be burned. A collateral top-up re-locks the NFT and resets the age, so a freshly topped-up identity cannot be burned immediately. Burn `age` is measured in blocks and is bounded by the CashTokens/CashScript ceiling the covenant can detect; an identity aged beyond that ceiling must still be burnable. **Compiled and VM-verified in task E** (`conformance/identity-vault-burn-delay.test.mjs`, libauth VM at `BCH_2026_05`): the VM rejects sequences below 144, sequences with the CSV disable flag set, and seconds-unit sequences; the burn must declare a relative-lock sequence in block units (see Section 5).
- **RF-O07** (Ubiquity): When a P2PKH change output exists in a genesis or in a vault spend, it must not carry tokens of the operation's category.

### 4.3 Receipt

- **RF-O08** (Events): When a receipt is issued, the system must require the joint signature of both parties in the genesis transaction.
- **RF-O821** (Ubiquity): The receipt's genesis covenant must require `partyA` and `partyB` to be **distinct** addresses. A self-receipt is not a Receipt: both Rating Rights would be locked to the same P2PKH, and the Receipt would attest that a wallet interacted with itself, which is precisely the claim a reputation protocol must not let it make.
- **RF-O822** (Ubiquity): `partyA`'s Rating Right must be locked under `RatingRightVault` instantiated with `partyA`'s pkh, and `partyB`'s symmetrically. A P2PKH lock does not satisfy this requirement: the UTXO single-spend rule forbids spending one *outpoint* twice but says nothing about the tokens it carries, so a P2PKH holder could return an identical NFT in a new output and rate again.
- **RF-O09** (Ubiquity): The receipt's genesis must contain exactly four outputs: receipt (output 0), `partyA`'s Rating Right (output 1), `partyB`'s Rating Right (output 2) and P2PKH change to `partyA` (output 3), all four of the same category except the change, and all without fungibles.
- **RF-O10** (Ubiquity): The receipt must be locked to `partyA`'s P2PKH and have an **empty** `nftCommitment` (legacy form) or a 4-byte/36-byte **interaction context** commitment (SPEC-009 §9.2); `partyA`'s Rating Right must have `commitment = partyB's pkh`, and `partyB`'s `commitment = partyA's pkh` (cross relationship).
- **RF-O11** (Ubiquity): The receipt's change output must be `partyA`'s P2PKH and carry no tokens of the issued category.

### 4.4 Rating

- **RF-O12** (Ubiquity): The protocol must represent each Rating Right as a **single-use covenant UTXO** whose only path destroys the NFT, guaranteeing at most one rating per participant per receipt.
- **RF-O823** (Ubiquity): `RatingRightVault` must expose exactly one spend path. It must not permit the NFT to be preserved in any output, which also makes the right non-transferable: declining to rate and giving the right away are the same act.
- **RF-O824** (Ubiquity): `RatingRightVault` must require the holder's signature on its only path, and must not read the `OP_RETURN`. The number of ratings is enforced by the destruction of the NFT; what a rating said (tag, score, ratee) is the indexer's business (RF-O13, RF-O14).
- **RF-O825** (Ubiquity): The receipt's genesis must lock the two Rating Rights to the P2SH32 hashes of `RatingRightVault` instantiated for each party. P2SH32 is the only form a CashScript contract address has, because `new Contract(...)` emits `OP_HASH256 <32> OP_EQUAL`; a P2SH20 lock would be a form the compiler never produces and no deployed right could satisfy. Because CashScript 0.13 cannot reference a contract by name, this commitment travels through the genesis contract's constructor arguments as two `bytes32` values; a receipt is only recognized if those hashes match the canonical `RatingRightVault` bytecode for the derived parties (SPEC-009 RF-W47/RF-W56).
- **RF-O13** (Events): When a rating is issued, the system must include an `OP_RETURN` with the `REPID_RATING1` tag and an integer score in the 1–5 range.
- **RF-O14** (Undesired Behavior): If the score is outside the 1–5 range, then the fact must be recognized with `valid: false` (the emitted transaction is not considered a valid rating).
- **RF-O826** (Events): When a rating is issued with `REPID_RATING2`, the system must attach the score (1–5) and a 32-byte `commentHash` computed over `REPID-CMT-V1`, the Receipt's `receiptCategory`, the rater's `pkh`, a salt and the off-chain comment (SPEC-009 §4.2); the NFT is destroyed exactly as with `REPID_RATING1`. The preimage is byte-exact and salted: `REPID-CMT-V1` (12 ASCII bytes) ‖ `receiptCategory` (32 bytes, display order) ‖ `raterPkh` (20 bytes) ‖ `saltLen` (1 byte, 16–32) ‖ `salt` ‖ `comment` (UTF-8, NFC), SHA-256 once (SPEC-004 RF-10/RF-11, SPEC-009 Annex B.4).
- **RF-O827** (Events): When a rater retracts a rating, the system must spend the rater's own P2PKH UTXO and include an `OP_RETURN` with the `REPID_RETRACT1` tag and the referenced Receipt's txid (32 bytes). The retraction needs no Rating Right (RF-O824 already destroyed it when the rating was issued).
- **RF-O828** (Undesired Behavior): If a retraction references an unknown rating, is not signed by the original rater, or is a repeated retraction of the same rating, then the fact must be recognized with `valid: false`; the original `RATING_ISSUED` is never deleted.

### 4.5 Platform validation and Trust Link

- **RF-O15** (Events): When a platform validates an interaction, the system must spend its own P2PKH UTXO and include an `OP_RETURN` with the `REPID_PLATFORM1` tag and the receipt's txid (32 bytes).
- **RF-O16** (Events): When A declares trust in B, the system must spend A's P2PKH UTXO and include an `OP_RETURN` with the `REPID_TRUST1` tag and B's pkh (20 bytes).
- **RF-O17** (Undesired Behavior): If a Trust Link declares trust about its own `trusterPkh` (self-trust), then the fact must be recognized with `valid: false`.
- **RF-O829** (Undesired Behavior): If the confirming entity of a platform validation is `partyA` or `partyB` of the referenced Receipt, then the fact must be recognized with `valid: false`: a party cannot corroborate its own interaction (self-corroboration, SPEC-003 RF-10).

### 4.6 Mutability

- **RF-O18** (Ubiquity): Identity, receipt and Rating Right NFTs must not be mutable nor re-mintable; the category, once created, must not be re-issued.
- **RF-O19** (Ubiquity): An on-chain fact must not be modifiable nor deletable; only new facts can be issued (e.g. burning an identity does not erase its genesis; retracting a rating does not erase the rating).
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
- **Bound fact**: a recognized fact whose covenant-backed bytes were verified against the canonical covenant this spec requires for its type. Binding is an optional verification (SPEC-009 §12) and is what separates a fact the protocol vouches for from a shape anyone can produce.
- **RepID identity**: the standing created by an `IDENTITY_GENESIS` that is **bound** to the canonical identity covenant in vault form. It is what an interpretation counts when it says a party has an identity. A recognizer that does not verify binding establishes only that a shape was seen, never that an identity exists.
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
- **RF-V12** (Undesired Behavior): If a genesis transaction matches the shape of a §3 genesis but is not bound to the canonical covenant that §4 requires for its type, then the system must not treat it as having created a RepID identity, a Receipt or any Rating Rights. A shape match alone establishes none of them, because CashTokens lets any script mint a category.
- **RF-V13** (Events): The system must still recognize an `IDENTITY_GENESIS` in legacy form — the NFT issued straight to a P2PKH, with no covenant and no collateral — so that the history of identities minted before the vault remains readable, and must not treat it as creating a RepID identity. Legacy genesis is a recorded fact, not an issuance: it is neither current nor deprecated, and it is not the way a new identity is created.
- **RF-V14** (Events): When a rating retraction is recognized, the system must emit a `RATING_RETRACTION` fact with `raterPkh`, `receiptTxid` and `valid`, and retain the reference (SPEC-005 RF-27) so that a repeated retraction is marked invalid deterministically (SPEC-004 RF-07).
- **RF-V15** (Events): When a receipt is recognized with an interaction context commitment, the system must emit its `receiptContext` fields and keep unknown `category`/`role` values raw (SPEC-005 RF-23).
- **RF-V16** (Events): When a rating is recognized from a `REPID_RATING2` spend, the system must include the `commentHash` in `RATING_ISSUED`; the comment itself is never recognized (SPEC-004 RF-09).
- **RF-V17** (Undesired Behavior): If the confirming entity of a platform validation is `partyA` or `partyB` of the referenced Receipt, the system must mark the `PLATFORM_CONFIRMATION` invalid (recognizer-level restatement of RF-O829 / SPEC-005 RF-26).

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
| **Reputation farming** | One rating per Rating Right (`RatingRightVault` destroys the NFT) | Weigh by counterparty/recency/collateral | Nothing prevents multiple valued interactions |
| **Selective acceptance** | A non-existent receipt produces no facts | — | There is no on-chain recourse if a party refuses to sign |
| **Rating manipulation** | Score outside 1–5 → `valid: false`; fixed range; `REPID_RATING2` attaches only a comment hash, never the comment | Judgment about the rating's intent and its `commentHash` fidelity | The protocol does not verify the score's truthfulness |
| **Retraction** | A retraction is unilateral, keyed by the rating's Receipt txid, and recognized at most once per rating (`REPID_RETRACT1`) | Weigh retracted ratings; a "Receipt without a rating" is only an interpretation signal (SPEC-003 RF-09) | The original rating is never deleted at the chain level; a rater can retract to reshape its perceived record |
| **Self-corroboration** | A platform confirming its own receipt → `valid: false` (RF-O829) | Count **distinct** platforms (deduplication) | A platform that changes keys evades the rule (declared in the white paper §14) |

### 7.2 Requirements (EARS)

- **RF-S01** (Ubiquity): The protocol must prevent double rating per participant and per receipt at the chain level, through `RatingRightVault`'s destruction of the NFT on its only spend path. This is a covenant rule, not a single-spend assumption.
- **RF-S02** (Undesired Behavior): If a Trust Link is self-trust, the system must mark it invalid.
- **RF-S03** (Undesired Behavior): If a score is outside the 1–5 range, the system must mark it invalid.
- **RF-S04** (Prohibition): The protocol must not present any anti-sybil, anti-spam or anti-collusion mitigation as guaranteed if it depends on the interpretation layer.
- **RF-S05** (Ubiquity): The known limitations of §7.1 must be explicitly documented and must not be claimed as solved.
- **RF-S06** (Undesired Behavior): If the confirming entity of a platform validation is `partyA` or `partyB` of the referenced Receipt, the system must mark the `PLATFORM_CONFIRMATION` invalid (self-corroboration).
- **RF-S07** (Undesired Behavior): If a retraction references an unknown rating, was not signed by the original rater, or is a repeated retraction of the same rating, the system must mark the `RATING_RETRACTION` invalid.

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

> Informational content. Describes the implementation of the **reference
> implementation**, which lives in separate repositories. It creates no
> conformity obligations; another implementation may differ in any of these
> aspects. See `REFERENCE-IMPLEMENTATION.md` at the root of this repository for
> the full requirement-to-test mapping.

- **Contracts (CashScript 0.13.2)**: `contracts/identity_vault.cash` (`mint`/`increaseCollateral`/`burn`), `contracts/receipt_genesis.cash` (`mint` with joint signature), `contracts/identity_genesis.cash` (single-use legacy form). These sources are **normative and live in this repository**; they are the canonical text of the covenants.
- **Recognition**: a recognizer conforming to SPEC-005, published as `repid-sdk` in its own repository. In-memory and durable stores are that project's concern, not this protocol's (SPEC-005 §8).
- **Interaction layer (RFC-002)**: off-chain metadata validation, outside the protocol.
- **Demo and console**: a separate interoperability application. It is an example of how a third party might build on the protocol, not part of it.
- **Persistence and network**: implementation choices, explicitly unconstrained by this protocol.

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

The full matrix, and the honest limits of the evidence behind each row, are in
`REFERENCE-IMPLEMENTATION.md` at the root of this repository. It is kept out of
this specification on purpose: the mapping changes as the reference
implementation is refactored, and a normative document must not churn for
non-normative reasons.

Three facts belong here because they constrain what any implementation may claim:

- The covenant **ABI has no automated regression coverage.** The mock-based unit
  tests that provided it were removed. Conformance of a covenant is therefore
  established by execution on a real Bitcoin VM, not by a passing test suite.
- The **compiler-emitted artifact fingerprint is not a conformance anchor**: it
  does not change when a contract changes (SPEC-005 §6). Use
  `tools/check-artifacts.mjs`.
- The **identity-vault burn delay (RF-O831) is compiled and VM-verified for
  `0.4.0`** (task E): `conformance/identity-vault-burn-delay.test.mjs` runs the
  compiled covenant through libauth's Bitcoin Cash VM at the current consensus
  target (`BCH_2026_05`) and asserts the matrix — sequence 143 rejected,
  144/145 accepted, the CSV disable flag rejected (it does NOT bypass the
  delay), seconds-unit sequences rejected. The bytecode registry in
  `protocol/covenant-bytecode.json` carries the compiled `0.4.0` body under its
  entry in `identityVault.versions`.

## Out of Scope

- Reputation, trust, weighting, propagation and recency algorithms.
- Collusion, farming, sybil or spam detection (interpretation layer).
- Resolution of the `pkh → Identity` link.
- Multi-party interactions (>2); multi-party receipts.
- Private-key recovery or identity revocation without burn.
- Disputes, interaction cancellation and rating comments with free text (only the `commentHash` of a comment travels on-chain; the comment itself never does).
- Production persistence and deployment network choice.

## Acceptance Criteria (Definition of Done)

- [x] The nine protocol sections (principles, model, events, on-chain rules, verification, reputation, security, interoperability, conformance) are specified.
- [x] The eight §3 events have a normative field schema, published as `protocol/schemas/repid-fact.schema.json` and checked by `conformance/schema.test.mjs` against the five facts reconstructed from a real Chipnet run. (`RATING_RETRACTION`, `receiptContext` and `commentHash` are new in `0.4.0`; their vectors are executed by task E — see SPEC-009 Annex B.3.)
- [x] The §4 on-chain invariants are backed by the covenants and their real-VM evidence, with the loss of mock-based ABI regression coverage declared (see `REFERENCE-IMPLEMENTATION.md` §3). The `0.4.0` burn delay (RF-O831) is compiled and VM-verified (task E, `conformance/identity-vault-burn-delay.test.mjs`).
- [x] The facts/interpretation boundary is declared, and reputation and the Confidence Index are marked non-normative and owned by the application layer (SPEC-007, in the demo repository).
- [x] The RF → code → test matrix references real tests and states the limits of each kind of evidence.
- [x] SPEC-008 prevails over the other specifications in case of conflict (precedence note).
- [x] Protocol version is explicit and machine-readable (`protocol/protocol-version.json`, SPEC-010), currently `0.5.0` with stated promotion criteria; it is the audited surveillance step of `0.4.0` (SPEC-010 §2).
- [x] Conformance suite green: `npm test` → 52 tests, 0 failures, running unconditionally. Covenant artifacts reproduce under `npm run artifacts:check`.
- [x] Lote 2 (`0.4.0`): `RATING_RETRACTION`, the receipt interaction context, `REPID_RATING2`/`commentHash`, self-corroboration invalidation and the identity-vault burn delay all have executable conformance vectors, executed by task E: `b3_0_4_0_vectors` (18 tests, reference SDK) plus `conformance/identity-vault-burn-delay.test.mjs` (6 tests, VM), traced per RFF in the SDK traceability manifest. The protocol version is bumped to `0.4.0`.
- [x] Every contract artifact recompiles to the committed bytecode, ABI, embedded source and debug bytecode, verified by a negative test that the check actually fails on a modified contract.
- [ ] An independent implementation has verified these rules end to end. Until it does, the protocol stays at `0.y.z` (SPEC-010 §2).
- [ ] The code complies with `constitution.md`.