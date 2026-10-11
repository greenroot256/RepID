# SPEC-003: Interaction Receipt Protocol

## 1. Context and Objective

The Interaction Receipt is the central immutable fact of RepID: an NFT that can only exist if both parties of an interaction signed it jointly. It acts as an **anti-corruption layer** between the application-specific interaction protocols (RFC-002) and the RepID core, preventing external business logic from contaminating the base protocol.

## 2. User Stories

- As a pair of participants in an interaction, I want to jointly sign an immutable receipt so that it is recorded as a verifiable fact on the chain.
- As a participant, I want to receive a Rating Right at the moment the receipt is created, so I can rate the other party later without relying on any additional third-party action.

## 3. Functional Requirements (EARS Syntax)

- **RF-01** (Ubiquity): The system must mint an Interaction Receipt NFT only when both parties jointly sign the genesis transaction.
- **RF-02** (Ubiquity): The system must mint, in the same genesis transaction, two Rating Right UTXOs, one per party.
- **RF-03** (Ubiquity): The system must fix participation at exactly two parties per receipt.
- **RF-04** (Ubiquity): The system must lock the Interaction Receipt to `partyA`; this rule is enforced by the covenant (`ReceiptGenesisValidator`), not mere application convention.
- **RF-05** (Ubiquity): The system must act as an anti-corruption layer, without inheriting application-specific business logic into the Receipt.
- **RF-06** (Events): When a validating entity (platform/application) wants to corroborate that an interaction occurred, the system must record a confirmation as an independent on-chain fact (separate attestation), without modifying the Receipt's genesis transaction.
- **RF-07** (Ubiquity): The Receipt's genesis transaction must include a P2PKH change output to `partyA` (the party that funds the genesis); the change may not carry tokens minted in that same transaction. This enables spending on the real network (Chipnet) without losing the funding UTXO's value in fees.
- **RF-08** (Ubiquity): The system MAY attach an optional **interaction context** to the Receipt's NFT commitment: a 4-byte form (`0x10 · category · roleA · roleB`) or a 36-byte form (`0x11 · category · roleA · roleB · contextHash`) per SPEC-009 §9.2; the **empty** commitment remains the legacy form. When present, the context is jointly signed by both parties as part of the genesis transaction and must not carry application-specific identifiers, prices, free text or judgments (RF-05). Roles are bound to the two parties already present in the Receipt: `roleA` describes the party that locks output 0 (`receiptOwnerPkh`) and `roleB` the other party (from the cross pair of Rating Rights); no third `pkh` enters the commitment.
- **RF-09** (Ubiquity): The system must treat a Receipt as proof that both parties **agreed** on an interaction, not that the interaction occurred. Occurrence is corroborated, if at all, by a separate on-chain attestation (`PLATFORM_CONFIRMATION`, RF-06). When the parties mint the Receipt at the start of the interaction, this is licit and documented: a "Receipt without a rating" is then only an interpretation signal, not a protocol fact.
- **RF-10** (Undesired Behavior): If the confirming entity's `pkh` equals `partyA` or `partyB` of the referenced Receipt, then the system must recognize the `PLATFORM_CONFIRMATION` with `valid: false`, because a party cannot corroborate its own interaction.

## 4. Non-Functional Requirements

- The joint signature must be verified at the covenant level (CashScript), not delegated to off-chain validation.
- No commit-reveal scheme is required: the Receipt is signed before any rating exists, so there is no sensitive information to protect at that point.

## 5. Edge Cases and Constraints

**Design decisions:**
- RF-03: participation is fixed at exactly 2 parties per receipt. Group interactions are modeled as multiple pairwise receipts (one per pair) at the application layer. Extension to N parties is out of scope.
- RF-04: locking the Receipt to `partyA` is a rule imposed by the covenant (`ReceiptGenesisValidator`), not an application convention. The only remaining convention is that the application defines who `partyA` is (RFC-002).
- RF-08: the interaction context is **generic and closed**. Unknown `category` or `role` values remain valid facts (tolerant reading, SPEC-009 RF-W73); reserved codes are never reassigned; adding a byte to the commitment is a `MAJOR` format change published under a new format nibble (`0x12+`). Adding a value in the unassigned space is `MINOR`.
- RF-09: minting the Receipt at the start of an interaction is allowed, but the elevation of a promise into a receipt must be a conscious joint act; an escrow that mints at settlement must not mint a **second** Receipt — one Receipt per interaction, and never both at start and at settlement (two Receipts mean two Rating Rights per person and therefore possible double rating).
- RF-10: the rule only forbids **self-corroboration**. Counting **distinct** platforms (deduplication) is the interpreter's job; a platform that changes keys can evade the rule, and this limitation is declared in the white paper (§14).

- Missing signature from either of the two parties → the genesis transaction is invalid and nothing is minted (neither Receipt nor Rating Rights).
- Confirmation of an interaction by a third party (platform) → separate attestation with a P2PKH spend + `OP_RETURN` (pattern analogous to `ISSUED_RATING`), not a covenant extension. The confirming entity spends its own UTXO with a protocol tag and a reference to the already-indexed Receipt's txid.

**Design decision (platform confirmation, "pattern C"):**
- The validator does not need to mint its own Identity: its pkh suffices (P2PKH spend of the UTXO it signs).
- The Indexer recognizes `PLATFORM_CONFIRMATION` only if the referenced Receipt was already indexed (traceability). If an unknown Receipt is referenced, the fact is recognized but marked `valid: false` (it is not silently ignored).

## 6. Out of Scope

- Commit-reveal scheme for ratings (unnecessary for the MVP; see Non-Functional Requirements).
- Multi-party receipts (>2). Group interactions are decomposed into pairwise receipts at the application layer.
- Modifying the genesis transaction to include the validator: platform confirmation is always a separate fact (RF-06), never added to the Receipt's genesis.
- On-chain cancellation or revocation of an interaction Receipt — future iteration. A correction is always a **new fact** that the interpreter weighs; the chain records, it does not rescind (over ratings, `RATING_RETRACTION`, SPEC-004; over Receipts, nothing exists yet).
- On-chain key rotation or recovery — future iteration (SPEC-010 `0.4.0`; see the white paper §14).
- Deduplicating platform confirmations — interpretation layer, not protocol (RF-10).

## 7. Acceptance Criteria (Definition of Done)

- [x] The genesis transaction requires the joint signature of both parties.
- [x] Two Rating Rights are minted together with the Receipt in a single transaction.
- [x] The covenant requires the P2PKH change output to `partyA` and rejects hidden mintings (10 `ReceiptGenesisValidator` tests, RF-07).
- [x] Design decisions in section 5 confirmed by the project architect (TASK-001, TASK-002).
- [x] `PLATFORM_CONFIRMATION` (RF-06) covered by indexer tests (TASK-016).
- [x] RF-08 (context commitment: 4/36 bytes recognized, malformed lengths reject, unknown values tolerated) covered by conformance vectors (task E executed 2026-10-07: `b3_0_4_0_vectors.test.ts` RF-W73).
- [x] RF-09 (lifecycle: agreement vs occurrence) documented normatively; requires no executable vector (guía `A-DECISIONES.md` P.2.2).
- [x] RF-10 (self-corroboration → `valid: false`) covered by conformance vectors (task E executed: `b3_0_4_0_vectors.test.ts` RF-W71).
- [ ] The code complies with `constitution.md`.