# SPEC-004: RepID Rating Protocol

## 1. Context and Objective

Once an Interaction Receipt has been issued, each party holds a Rating Right: the right to rate the other party exactly once. Both rights are locked by the Receipt's genesis to the P2SH32 hashes of the `RatingRightVault` covenant (SPEC-008 RF-O822/RF-O825); that covenant exposes a single spend path that destroys the NFT (SPEC-008 RF-O823), which makes the "one rating per participant" guarantee a chain-level covenant rule (SPEC-008 RF-S01), not a single-spend assumption.

## 2. User Stories

- As a participant in an interaction, I want to rate the other party using my Rating Right, to leave a verifiable reputation fact on the chain.
- As a protocol observer, I want to be able to trust that nobody can rate twice for the same interaction.

## 3. Functional Requirements (EARS Syntax)

- **RF-01** (Ubiquity): The system must represent each Rating Right as a single-use covenant UTXO: `RatingRightVault` instantiated with the holder's `pkh` (SPEC-008 RF-O822), so the right cannot be transferred or re-emitted (SPEC-008 RF-O823).
- **RF-02** (Events): When the holder spends its Rating Right in rating mode, the system must include an `OP_RETURN` payload with the rating — an integer score between 1 and 5 (`REPID_RATING1`, optionally `REPID_RATING2` when a `commentHash` accompanies it, SPEC-009 §4.1/§4.2).
- **RF-03** (Ubiquity): The system must burn the Rating Right NFT on the covenant's only spend path (SPEC-008 RF-O823), guaranteeing that only one rating can be issued per participant per Receipt at the chain level (SPEC-008 RF-S01).
- **RF-04** (Undesired Behavior): If the score included in the rating `OP_RETURN` is outside the 1–5 range, then the system must recognize the `RATING_ISSUED` with `valid: false` (it is not silently ignored; enforced by the conditional in `protocol/schemas/repid-fact.schema.json`). Applies to `REPID_RATING1` and `REPID_RATING2` alike.
- **RF-05** (Ubiquity): The system must record each Rating Right's commitment using the **counterparty's** `pkh` — the cross pair: `partyA`'s right carries `partyB`'s pkh and vice versa (SPEC-008 RF-O822) — instead of the full Identity NFT category.
- **RF-06** (Events): When a rater wants to retract a rating it already issued, the system must record a `RATING_RETRACTION` as an independent fact: the rater spends its own P2PKH UTXO with `REPID_RETRACT1` (SPEC-009 §4.5) referencing the txid of the rating's Receipt. The retraction is unilateral: it needs no consent from the ratee and no second Rating Right (the original rating path already destroyed the NFT).
- **RF-07** (Undesired Behavior): If the `REPID_RETRACT1` reference is unknown, the spender is not the signer of the original rating, or a retraction for that rating already exists, then the system must recognize the `RATING_RETRACTION` with `valid: false`. The original `RATING_ISSUED` is never deleted; the chain records, it does not rescind (SPEC-010).
- **RF-08** (Events): When the holder spends its Rating Right with `REPID_RATING2`, the system must decode the score (1–5) and the attached `commentHash` (32 bytes) into the `RATING_ISSUED` fact.
- **RF-09** (Ubiquity): The system must never decode, store or judge the comment behind `commentHash`; verifying the correspondence between hash and comment is off-chain work for the application that knows the preimage (`REPID-CMT-V1`).
- **RF-10** (Ubiquity): When a `RATING_ISSUED` fact carries a `commentHash`, the preimage used to compute it must be the byte concatenation `REPID-CMT-V1` (12 ASCII bytes) ‖ `receiptCategory` (32 bytes, display order — the category of the Receipt the rating belongs to) ‖ `raterPkh` (20 bytes, display order) ‖ `saltLen` (1 byte, unsigned value 16–32) ‖ `salt` (`saltLen` bytes) ‖ `comment` (UTF-8, NFC-normalized), hashed once with SHA-256 (SPEC-008 RF-O826; the exact byte layout and its vectors live in SPEC-009 Annex B.4).
- **RF-11** (Ubiquity): The rater must draw the salt fresh for each rating from a cryptographically secure random source, with a length between 16 and 32 bytes; the salt is only ever revealed off-chain, together with the comment, to whoever verifies the correspondence.

## 4. Non-Functional Requirements

- The Rating Right is a covenant, not a bare P2PKH: `RatingRightVault` (SPEC-008 RF-O822) — its single spend path destroys the NFT and requires the holder's signature (SPEC-008 RF-O824), so the "one rating" guarantee lives at the chain level; no wallet can re-emit the same NFT.
- The covenant never reads the rating's `OP_RETURN` (SPEC-008 RF-O824); tag, score and references are recognized by the Indexer (SPEC-009).
- A retraction is unilateral and cheap to express: one P2PKH spend plus an `OP_RETURN`, no Rating Right required.
- The Indexer must be able to detect the `OP_RETURN` and decode the score unambiguously.

## 5. Edge Cases and Constraints

**Design decisions:**
- RF-05: the Rating Right commitment uses the **counterparty's** pkh (the cross pair), not the owner's. `partyA`'s right carries `partyB`'s pkh and vice versa; the pkh → Identity link (RFC-001) is resolved in a later, off-chain layer (per Article 1 of the Constitution).
- RF-06: a retraction is a **new** fact, not a mutation of the rating. The rater can only retract once per rating because the retraction is keyed by the rating's Receipt txid (RF-07); a genuine re-rating requires a new Interaction Receipt.
- RF-08/RF-09: the `commentHash` travels on-chain but the comment stays off-chain; the hash commits the parties to a verifiable text without paying for storage or content review.
- RF-10/RF-11: the preimage is byte-exact and order-sensitive. The comment is hashed **after** UTF-8 NFC normalization, so `café` written with a precomposed vs decomposed `e` produces a different byte sequence on disk but the same digest; `raterPkh` is in display order. The `receiptCategory` binds the utterance to exactly one Receipt, so the same comment and score cannot be replayed across two interactions of the same rater. The salt adds unpredictability so the same comment by the same rater does not reveal itself by hash equality; it makes the correspondence an off-chain proof, not a chain-level property.
- The interaction `contextHash` deliberately has **no published preimage format** (SPEC-003 RF-08, `A-DECISIONES.md` decision P6): the protocol binds the context bytes to the Receipt but assigns no meaning to them, and the recognizer never decodes them. An early draft published `SHA256('REPID-RCTX-V1' ‖ metadata)`; that rule was removed before release — see `A-DECISIONES.md`, and `protocol/constants.json` for the (corrected) 13-byte prefix fact.

- `addOpReturnOutput` treats strings as UTF-8 unless they are prefixed with `"0x"` — a risk of encoding the score incorrectly if the prefix is not used.
- A score outside the 1–5 range is recognized but marked `valid: false` by the recognizer; it is not silently ignored (RF-04, and enforced by the conditional in `protocol/schemas/repid-fact.schema.json`).
- An empty `commentHash` is equally valid: `RATING_ISSUED` without a comment is the legacy and default form.

## 6. Out of Scope

- On-chain reputation aggregation algorithms (composite score computation, averages, weights).
- Disputes or challenges to an already-issued rating (a retraction is a new fact that interpreters weigh, never a mutation).
- Free text inside the `OP_RETURN` payload: only the numeric score 1–5 is admitted, plus — with `REPID_RATING2` — its `commentHash`; the comment itself lives off-chain and is never validated on-chain (RF-09).
- App-level policy on what a retraction means for a given score (withdrawal of the rating, revocation of the interaction claim) — that is interpretation (SPEC-007, in the demo repository, external and non-normative), not protocol.

## 7. Acceptance Criteria (Definition of Done)

- [x] `ISSUED_RATING` implemented: Rating Right spend with a score `OP_RETURN`, NFT burn enforced by the covenant.
- [x] Explicit score-range validation (RF-04) covered by a test (scores 0, 6 and 200 marked invalid; TASK-008).
- [x] Section 5 assumption confirmed by the project architect: commitment with the owner's pkh (TASK-003) — **superseded** by the lote-2 correction to the cross pair (RF-05, `A-DECISIONES.md` P.2.3).
- [x] RF-05 corrected to the cross pair (counterparty's pkh); adopted by default in the audit, `A-DECISIONES.md` P.2.3 ("se corrige obligatoriamente").
- [x] RF-06/RF-07 (`RATING_RETRACTION`: unilateral reference, `valid: false` on unknown/wrong-signer/repeated) covered by conformance vectors (task E executed: `b3_0_4_0_vectors.test.ts` RF-W66..W70).
- [x] RF-08/RF-09 (`REPID_RATING2` → `commentHash` in `RATING_ISSUED`; comment never decoded) covered by conformance vectors (task E executed: `b3_0_4_0_vectors.test.ts` RF-W64/W65).
- [x] RF-10/RF-11 (byte-exact `commentHash` preimage with the receipt binding, salted comment, UTF-8 NFC normalization) covered by KAT vectors (`conformance/comment-hash-vectors.test.mjs`).
- [ ] The code complies with `constitution.md`.