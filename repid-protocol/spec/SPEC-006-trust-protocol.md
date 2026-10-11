# SPEC-006: Trust Protocol (Trust Link)

## 1. Context and Objective

A brand-new identity, with no interactions nor ratings, has no reputation: that is the *cold start* problem. The **Trust Link** lets one identity declare, on-chain, that it trusts another: a direct person→person endorsement that requires neither the consent of the trusted party nor a previous interaction.

It is a fact of **unilateral social declaration**, different from the interaction+rating pair (bilateral): here there is no Receipt, no Rating Rights, and rating the trusted party is not enabled. The indexer records it as one more fact, and the (future) off-chain reputation layers will be able to use it to support the initial reputation of new identities.

## 2. User Stories

- As an established identity, I want to openly declare that I trust another identity, to give a reputation signal to others before any interactions exist.
- As a protocol observer, I want to unambiguously distinguish a trust declaration (unilateral, declarative) from a confirmed interaction (bilateral, with rating).

## 3. Functional Requirements (EARS Syntax)

- **RF-01** (Ubiquity): The system must represent a trust declaration as an independent, unilateral on-chain fact, without requiring the consent of the trusted party.
- **RF-02** (Events): When an identity A spends its own P2PKH UTXO with an `OP_RETURN` carrying the `REPID_TRUST1` tag and B's pkh, the system must recognize a `TRUST_LINK` fact with `trusterPkh` = A and `trustedPkh` = B.
- **RF-03** (Undesired Behavior): If A and B are the same pkh (self-trust), then the system must mark the fact as invalid.
- **RF-04** (Ubiquity): The declaration must not generate Rating Rights nor enable rating by itself: it is a declarative fact, without interaction debt.

## 4. Non-Functional Requirements

- Deterministic, shape-based recognition, same as the rest of the Indexer: no VM execution, no signature validation.
- The link is **unidirectional**: if B wants to trust A, it must issue its own declaration; there is no automatic reciprocity.
- Known and accepted anti-spam limit in the MVP: any identity can issue as many declarations as the fees it is willing to pay. The protocol records the fact; anti-sybil and weighting policies remain in the reputation layer (out of scope).

## 5. Edge Cases and Constraints

**Confirmed design decision** (Section E, TASK-018): the Trust Link is a **unilateral A→B declaration** — A spends its UTXO and signs; B does not sign nor does it know.

- A's pkh is recovered from the P2PKH scriptSig of the first input (same pattern as `PLATFORM_CONFIRMATION`, SPEC-003 RF-06). The second `OP_RETURN` chunk must be exactly 20 bytes (a pkh); any other length → the transaction is not recognized.
- If `trustedPkh === trusterPkh`, the fact is recognized but marked `valid: false` (not silently ignored; SPEC-005 pattern).
- The declaration may refer to any pkh, whether or not it has an Identity: the pkh → Identity link (SPEC-001) is resolved off-chain (Constitution, Article 1). Minimally validating the truster's identity is a possible future improvement, not an MVP one. **Design decision (2026-09-10)**: the current behavior is kept — any pkh may issue Trust Links; anti-sybil and weighting policies remain in the interpretation layer, out of this protocol.
- An `OP_RETURN` helper that accepts strings encodes them as UTF-8 unless they are explicitly prefixed with `"0x"` (SPEC-005 §6): B's pkh must be encoded as raw bytes, not as text.

## 6. Out of Scope

- Trust graph and reputation algorithms (PageTrust, weights, propagation) — an off-chain interpretation layer, and not part of this protocol (SPEC-008 §7). The demo repository implements a portion of it: reputation is the star average, and each received trust vote feeds an `endorsements` signal, which helps the cold start when a profile has no ratings yet.
- Revoking a trust declaration (a later spend that cancels it) — future iteration.
- Anti-sybil policies, minimum trusted reputation thresholds, or context weighting.
- Validating that the truster has an Identity in the Indexer itself.

## 7. Acceptance Criteria (Definition of Done)

- [x] `TRUST_LINK` recognized by a recognizer (RF-02).
- [x] Self-trust marked `valid: false` (RF-03).
- [x] `OP_RETURN` with a tag unrelated to RepID → not recognized.
- [x] The fact does not mint Rating Rights: the test transaction does not include them (RF-04).
- [x] The reference SDK covers this specification with 3 recognition tests; see `REFERENCE-IMPLEMENTATION.md` (RF-O16–RF-O17, RF-E07, RF-S02).
- [ ] The code complies with `constitution.md`.