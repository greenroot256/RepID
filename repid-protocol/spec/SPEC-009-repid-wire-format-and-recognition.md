# SPEC-009: RepID Wire Format and Recognition

> **Status**: normative. This spec defines the byte-level contract of RepID's
> `OP_RETURN` facts and the deterministic algorithm that recognizes them. It
> **complements** SPEC-008 §5; it does not replace it. Where both speak, they
> must agree, and any divergence is a defect in one of them.
>
> **Precedence**: `constitution.md` > SPEC-008 > **SPEC-009** > the remaining
> specifications in this repository. Those remain as *rationale* per feature.
>
> **Nature**: the requirements are **normative** insofar as they describe what a
> conformant *recognizer* must do. Sections marked *non-normative* are context
> and create no conformity obligation.
>
> **Why this spec exists**: SPEC-008 specifies the protocol *model* — entities,
> events, on-chain invariants, validity semantics. The exact encoding that a
> fact has on the wire, and the order in which recognizers are tried, were
> implemented in `@repid/indexer` but were never stated normatively. An
> independent implementation had no document to conform to. This spec is that
> document.

## 1. Scope and Precedence

RepID facts are reconstructed off-chain by **recognition**: decoding the raw
hex of a transaction and matching its *shape* against the event schemas of
SPEC-008 §3. Recognition is deterministic and does not execute the VM
(SPEC-008 §5, Constitution Article 1).

This spec fixes, byte-exactly:

- the `OP_RETURN` container encoding used by RepID facts (§3);
- the payload of each tag (§4);
- how a fact's *declaring party* is derived from the spending input (§5);
- where a fact's participants come from when they are **not** in the payload (§6);
- the order in which recognizers are applied (§7);
- the state transitions a conformant indexer must perform (§8).

### 1.1 Precedence and non-goals

- The **event schemas** (field names, types, semantics) are SPEC-008 §3. This
  spec does not restate or redefine them; it states how they are *obtained*.
- The **on-chain invariants** (what a covenant or a UTXO structure guarantees)
  are SPEC-008 §4. This spec describes the shapes an issuer must produce.
- **Reputation, Confidence Index, anti-sybil and every valuation** are out of
  scope and remain non-normative (SPEC-008 §6). The document that discusses them,
  SPEC-007, is owned by an application repository, not by this protocol. Nothing
  in this spec may be used to justify a score on-chain.
- **Signature validity is never re-checked** by a conformant recognizer. The
  network verified the spends; the indexer only reads shapes.

## 2. Notation and Byte Conventions

- `0x` prefixes a **raw byte** literal; all other string values in an
  `OP_RETURN` are UTF-8 (SPEC-008 §4.7).
- `byte[n]` is a payload of exactly `n` bytes. A length mismatch is never
  tolerated silently: it produces **no fact** (§4.6).
- `pkh` is the 20-byte `hash160` of a public key; `txid` is 32 bytes.
- **Byte order is not uniform**, and this is a normative hazard (SPEC-008 §4.7):
  - Inside a CashScript covenant, `tokenCategory` arrives in **internal** (inverted
    display) order.
  - libauth's `decodeTransactionBCH` delivers `outpointTransactionHash` and
    `token.category` already in **display** order and they **must not** be
    inverted.
  - A conformant recognizer must state, for every comparison, which order it is
    in. This spec uses **display order** for all wire-level strings unless it
    explicitly says otherwise.
- **Reference decoder (non-normative)**: the recognition SDK (`repid-sdk`),
  functions `parseOpReturn`, `extractPkhFromUnlocking`, `extractP2PKH` and
  `isEmptyBytes`. These are *exemplars*, not the definition: the rules in this
  section are the definition, and a recognizer that disagrees with the reference
  decoder while satisfying these rules is conformant.
  `REFERENCE-IMPLEMENTATION.md` maps each rule to its backing test.
- The tag values and their byte lengths are published machine-readably in
  `protocol/constants.json` (`opReturnTags`). If a recognizer's tag table
  disagrees with that file, the file wins.

## 3. The `OP_RETURN` Container

RepID facts that are *declared* (rating, platform confirmation, trust link)
travel in a single `OP_RETURN` output. Genesis facts (identity, receipt) carry
no `OP_RETURN`; they are recognized from their **output structure** (§9).

### 3.1 Encoding

An `OP_RETURN` script is `0x6a` followed by a sequence of **data pushes**:

```
OP_RETURN  <push tag>  <push payload>  [further pushes...]
0x6a       len data    len data
```

- **RF-W01** (Ubiquity): A conformant recognizer must read a RepID `OP_RETURN`
  as `0x6a` followed by **direct pushes only** — a one-byte length opcode
  `0x01`–`0x4b` introducing exactly `len` bytes — and must reject the
  multi-byte push forms.
- **RF-W02** (Undesired Behavior): If a push uses `OP_0` (`0x00`) or any
  `PUSHDATA1` (`0x4c`), `PUSHDATA2` (`0x4d`) or `PUSHDATA4` (`0x4e`) form, or if
  any push declares a length of `0` or greater than `75`, then the recognizer
  must treat the `OP_RETURN` as unparseable and emit **no fact**.
- **RF-W45** (Undesired Behavior): If a push declares a length that **exceeds
  the bytes remaining** in the script, the recognizer must treat the
  `OP_RETURN` as unparseable and emit **no fact**. A declared length that the
  script cannot satisfy is not a short chunk; it is a malformed container.

  This is the truncation companion to RF-W02, which bounds the declared length
  from above but not against the bytes that actually follow. It is stated as its
  own requirement because it is the case a length-bounded reader gets wrong by
  accident: slicing `len` bytes out of a buffer with fewer left yields the
  shorter chunk with no error at all, so a script whose last push claims five
  bytes and carries one is read as a well-formed one-byte payload — and under
  `REPID_RATING1` (§4) that is a score. The look-alike is the one §3.2 warns
  about, reached by truncation rather than by a wrong value.

  A suffixed identifier such as `RF-W02a` was considered and rejected: the
  repository's specification checker matches `RF-[A-Z]?\d+`, so a suffixed ID is
  read as its numeric prefix and the requirement becomes invisible to the
  tooling that is supposed to track it.
- **RF-W03** (Ubiquity): A conformant recognizer must require **at least two**
  pushes: the tag and at least one payload chunk.
- **RF-W04** (Ubiquity): The first push must decode as UTF-8 and must equal the
  tag expected by the recognizer; a recognizer must compare tags by exact byte
  equality, not by prefix or case-insensitive matching.

### 3.2 Chunks

The pushes after the tag are exposed to each recognizer as an ordered list of
byte chunks. Chunk boundaries are significant and are part of the contract: a
recognizer must **not** concatenate the remaining pushes before validating
their individual lengths, because the per-tag length rules in §4 are what
distinguish a well-formed fact from a look-alike.

- **RF-W05** (Ubiquity): Each recognizer must validate the exact **number** of
  chunks and the exact **length** of each chunk required by §4 before emitting a
  fact.

## 4. Tag Payloads

Five tags are defined. Their values are published as
`REPID_RATING_TAG`, `REPID_RATING2_TAG`, `REPID_PLATFORM_TAG`,
`REPID_RETRACT_TAG` and `REPID_TRUST_TAG` from `@repid/protocol`.

| Tag | Chunks | Payload | Meaning |
|---|---|---|---|
| `REPID_RATING1` | exactly 2 | `byte[1]` | score issued by the rater |
| `REPID_RATING2` | exactly 3 | `byte[1]` + `byte[32]` | score issued by the rater, followed by the `commentHash` of the off-chain comment |
| `REPID_PLATFORM1` | exactly 2 | `byte[32]` | `txid` of the validated Receipt |
| `REPID_RETRACT1` | exactly 2 | `byte[32]` | `txid` of the rated Receipt whose rating is being retracted |
| `REPID_TRUST1` | exactly 2 | `byte[20]` | `pkh` of the trusted party |

### 4.1 `REPID_RATING1` — issued rating

- **RF-W06** (Events): When a transaction's `OP_RETURN` carries exactly two
  chunks with tag `REPID_RATING1`, the second chunk of exactly one byte must be
  interpreted as an unsigned integer `score`, and the recognizer must proceed to
  resolve the rater and ratee per §6.
- **RF-W07** (Undesired Behavior): If the `REPID_RATING1` payload is not exactly
  one byte, or if the number of chunks is not exactly two, then the recognizer
  must emit **no fact** (this is a malformed container, not an invalid rating).
- **RF-W08** (Undesired Behavior): If `score` is outside the range 1–5
  (`MIN_SCORE`–`MAX_SCORE`), the recognizer must emit `RATING_ISSUED` with
  `valid: false`. It must not drop the fact, and must not clamp the value
  (SPEC-004 RF-04, SPEC-008 RF-O14).

### 4.2 `REPID_RATING2` — issued rating with comment hash

- **RF-W64** (Events): When a transaction's `OP_RETURN` carries exactly three
  chunks with tag `REPID_RATING2`, the second chunk of exactly one byte must be
  interpreted as an unsigned integer `score` and the third chunk of exactly 32
  bytes as the `commentHash`, and the recognizer must proceed to resolve the
  rater and ratee per §6 and to emit `RATING_ISSUED` carrying both `score` and
  `commentHash` (SPEC-008 RF-E05, RF-O826).
- **RF-W65** (Undesired Behavior): If the `REPID_RATING2` payload is not exactly
  `byte[1] + byte[32]` — wrong chunk count or wrong chunk lengths — then the
  recognizer must emit **no fact** (malformed container, per §4.6).
- The recognizer must never decode, store or judge the comment behind
  `commentHash`; hash fidelity is off-chain (SPEC-004 RF-09).
- The preimage behind `commentHash` is byte-exact and normative for producers:
  `REPID-CMT-V1` (12 ASCII bytes) ‖ `receiptCategory` (32 bytes, display order
  — the category of the Receipt the rating belongs to, recoverable on-chain from
  the tracked Rating Right) ‖ `raterPkh` (20 bytes, display order) ‖ `saltLen`
  (1 byte, unsigned value 16–32) ‖ `salt` (`saltLen` bytes) ‖ `comment` (UTF-8,
  NFC-normalized), hashed once with SHA-256; the salt comes from a
  cryptographically secure random source and is never on-chain (SPEC-004
  RF-10/RF-11, SPEC-008 RF-O826). The recognizer does not verify it — a rating
  with a well-formed 32-byte `commentHash` is recognized regardless of what the
  preimage was — but a producer must follow this layout for the digest to be
  verifiable off-chain.

### 4.3 `REPID_PLATFORM1` — platform confirmation

- **RF-W09** (Events): When a transaction's `OP_RETURN` carries exactly two
  chunks with tag `REPID_PLATFORM1`, the second chunk of exactly 32 bytes must
  be interpreted as the `receiptTxid` of the corroborated Receipt, in display
  order.
- **RF-W10** (Undesired Behavior): If the payload is not exactly 32 bytes, the
  recognizer must emit no fact.
- **RF-W11** (Events): The confirming `platformPkh` must be resolved per §5 and
  `valid` must be `true` only if `receiptTxid` is already present in the
  receipt index; otherwise the fact must be emitted with `valid: false`
  (SPEC-008 RF-V08).
- **RF-W71** (Undesired Behavior): If the confirming `platformPkh` equals
  `partyA` or `partyB` of the referenced Receipt, the recognizer must emit the
  `PLATFORM_CONFIRMATION` with `valid: false` (self-corroboration: a party
  cannot corroborate its own interaction, SPEC-003 RF-10, SPEC-005 RF-26,
  SPEC-008 RF-O829 / RF-S06 / RF-V17).

### 4.4 `REPID_TRUST1` — trust link

- **RF-W12** (Events): When a transaction's `OP_RETURN` carries exactly two
  chunks with tag `REPID_TRUST1`, the second chunk of exactly 20 bytes must be
  interpreted as the `trustedPkh`, in display order.
- **RF-W13** (Undesired Behavior): If the payload is not exactly 20 bytes, the
  recognizer must emit no fact.
- **RF-W14** (Undesired Behavior): If `trustedPkh` equals the resolved
  `trusterPkh`, the fact must be emitted with `valid: false` (self-trust,
  SPEC-006, SPEC-008 RF-O17).

### 4.5 `REPID_RETRACT1` — rating retraction

- **RF-W66** (Events): When a transaction's `OP_RETURN` carries exactly two
  chunks with tag `REPID_RETRACT1`, the second chunk of exactly 32 bytes must be
  interpreted as the `receiptTxid` (display order) of the Receipt whose rating is
  being retracted, and the recognizer must proceed to resolve the declarer per §5
  and to emit a `RATING_RETRACTION` fact (SPEC-008 RF-E10, RF-O827).
- **RF-W67** (Undesired Behavior): If the `REPID_RETRACT1` payload is not exactly
  32 bytes, or the chunk count is not exactly two, the recognizer must emit
  **no fact** (malformed container, per §4.6).
- **RF-W68** (Undesired Behavior): If the referenced rating's Receipt is not in
  the ratings index, the recognizer must emit `RATING_RETRACTION` with
  `valid: false` (SPEC-004 RF-07, SPEC-008 RF-O828).
- **RF-W69** (Undesired Behavior): If the `raterPkh` resolved per §5 is not the
  `raterPkh` of the `RATING_ISSUED` that the referenced Receipt produced, the
  recognizer must emit `RATING_RETRACTION` with `valid: false`.
- **RF-W70** (Undesired Behavior): If the referenced rating is already in the
  retracted set (RF-W72), the recognizer must emit `RATING_RETRACTION` with
  `valid: false`. The original `RATING_ISSUED` is never deleted; the chain
  records, it does not rescind.

### 4.6 Malformed vs invalid

- **RF-W15** (Ubiquity): A conformant recognizer must distinguish a
  **malformed container** (wrong chunk count, wrong payload length, unparseable
  push) — which yields **no fact** — from a **semantically invalid fact** (a
  well-formed container that violates a range or reference rule) — which yields
  a fact with `valid: false`.

## 5. Deriving the Declaring Party

`REPID_PLATFORM1` and `REPID_TRUST1` do not carry the declarer's `pkh` in their
payload. It is derived from the spending input, because the only authority for
a fact is the signature that spent the value.

- **RF-W16** (Ubiquity): A conformant recognizer must derive the declaring
  party's `pkh` from the **first input's** unlocking bytecode
  (`unlockingBytecode`), by requiring a compressed public key push: the byte
  `0x21` at the position 34 bytes from the end, followed by exactly 33 bytes of
  public key at the end of the script, then `pkh = hash160(publicKey)`.
- **RF-W17** (Undesired Behavior): If the first input's unlocking bytecode is
  shorter than 35 bytes, or does not carry the `0x21` compressed-key marker in
  that position, the recognizer must emit **no fact** for a `PLATFORM1` or
  `TRUST1` payload, because the declarer cannot be attributed.
- **RF-W18** (Ubiquity): The derivation reads the public key from the **tail**
  of the unlocking bytecode, so it tolerates additional pushes before it (a
  signature push). A recognizer must not require the public key to be the first
  element of the script.

> **Deliberate limitation**: this derivation is a *shape* match, not a signature
> check. It reads a public key out of the scriptSig and hashes it; it does not
> verify that the signature over the transaction is valid for that key. That is
> correct for an indexer — the network already enforced the signature — but it
> means the derivation must not be reused as an authentication primitive
> (SPEC-008 §5, Article 1).

## 6. Participants Not Present in the Payload

`RATING_ISSUED` is the only fact whose participants are **not** recoverable from
its own outputs. This is by design: the Rating Right is a single-use UTXO, and
its commitment already encodes the counterparty.

- **RF-W19** (Events): When a `REPID_RATING1` or `REPID_RATING2` payload is
  well-formed, the recognizer must resolve `raterPkh` and `rateePkh` by looking
  up, for each input of the transaction, whether its outpoint (`txid:vout`) is a
  tracked Rating Right; `raterPkh` must be that right's `ownerPkh` and `rateePkh`
  must be its `ratesPkh`.
- **RF-W20** (Undesired Behavior): If no input of the transaction spends a
  tracked Rating Right, the recognizer must emit **no fact**. A bare
  `REPID_RATING1` or `REPID_RATING2` `OP_RETURN` with no matching right is a
  non-fact (SPEC-008 RF-V03).
- **RF-W21** (Events): When the Rating Right is resolved, the recognizer must
  remove that outpoint from the tracked set, because its spend implicitly burns
  the NFT and thereby consumes the right (SPEC-008 RF-O12, RF-V05).
- **RF-W22** (Ubiquity): The recognizer must **not** read `raterPkh` or
  `rateePkh` from the `OP_RETURN` payload; a rating payload is `byte[1]` (or
  `byte[1] + byte[32]` under `REPID_RATING2`) and carries no addresses by design.

## 7. Recognition Algorithm and Precedence

Recognition is a **first match wins** scan. The order is normative because two
recognizers can match the same transaction.

- **RF-W23** (Ubiquity): A conformant recognizer must apply recognizers in this
  fixed order and return the first fact produced, or no fact if none matches:

  | # | Recognizer | Fact | Store consulted |
  |---|---|---|---|
  | 1 | identity spend | `IDENTITY_COLLATERAL_TOP_UP` / `IDENTITY_BURNED` | tracked vault outpoints |
  | 2 | identity genesis | `IDENTITY_GENESIS` | — (then tracks) |
  | 3 | receipt genesis | `RECEIPT_GENESIS` | — (then tracks) |
  | 4 | issued rating | `RATING_ISSUED` | tracked Rating Rights |
  | 5 | platform confirmation | `PLATFORM_CONFIRMATION` | receipt index |
  | 6 | rating retraction | `RATING_RETRACTION` | ratings index / retracted set |
  | 7 | trust link | `TRUST_LINK` | — |

  `REPID_RATING1` and `REPID_RATING2` share the rating recognizer (step 4): the
  tag selects the payload form (§4, RF-W06 vs RF-W64). Retraction (step 6)
  needs the rating of the referenced Receipt to have been seen, so it follows
  the rating recognizer; no other recognizer can match its shape.

- **RF-W24** (Events): The identity **spend** must be attempted before the identity
  **genesis**, because a collateral top-up re-emits the same NFT toward the same
  covenant and therefore has the same shape as a genesis; only the outpoint
  trail (was this outpoint already tracked?) distinguishes them (SPEC-008 RF-V07).
- **RF-W25** (Ubiquity): A conformant recognizer must return **no fact** — not an
  error, not a partial result — for a transaction that matches no known shape
  (SPEC-008 RF-V03, RF-C03).
- **RF-W26** (Ubiquity): Recognition must be **deterministic**: the same raw hex
  against the same index state must always yield the same result (SPEC-008
  RF-V02).
- **RF-W27** (Ubiquity): A conformant recognizer must not run the VM and must not
  re-validate signatures; it must reconstruct from the raw hex alone
  (SPEC-008 RF-V01).

## 8. Indexer State Transitions

Recognition is only half the contract: a conformant indexer must also maintain
the small state the chain does not keep, or later facts cannot be validated.

- **RF-W28** (Events): On `IDENTITY_GENESIS` in vault form, the indexer must
  track the vault outpoint `txid:0` with `ownerPkh`, `identityCategory` and
  `collateral`.
- **RF-W29** (Events): On `IDENTITY_COLLATERAL_TOP_UP`, the indexer must move the
  tracking from the spent outpoint to the new vault outpoint.
- **RF-W30** (Events): On `IDENTITY_BURNED`, the indexer must remove the tracked
  vault outpoint.
- **RF-W31** (Events): On `RECEIPT_GENESIS`, the indexer must track both Rating
  Right outpoints (`txid:1`, `txid:2`) with their `ownerPkh`/`ratesPkh`, and must
  track the Receipt's `txid` with its owner.
- **RF-W74** (Events): On `RECEIPT_GENESIS`, when the first output's commitment
  carries an interaction context (RF-W73), the indexer must also retain it
  (`interactionCategory`, `roleA`, `roleB`, `contextHash`) alongside the Receipt,
  because the self-corroboration rule (RF-W71) and any later read of the context
  depend on it (SPEC-005 RF-23/RF-27).
- **RF-W32** (Events): On `RATING_ISSUED`, the indexer must remove the consumed
  Rating Right outpoint.
- **RF-W33** (Undesired Behavior): If a collateral fact does not preserve the NFT
  category and commitment, or if the new collateral is lower than the registered
  one, the indexer must emit the fact with `valid: false` and must not advance
  the tracking to an invalid state (SPEC-008 RF-V09).
- **RF-W34** (Ubiquity): The indexer must persist this state so that recognition
  survives a process restart (SPEC-008 RF-V10). The reference implementation uses
  a local JSON file via `createJsonFileStore`.
- **RF-W72** (Events): On `RATING_RETRACTION`, the indexer must add the
  referenced rating to the **retracted set** (SPEC-005 RF-27) so that a repeated
  retraction of the same rating is marked invalid deterministically (RF-W70). The
  retraction must not remove any tracking: the rating's Rating Right outpoint is
  already consumed by its own spend.

> **Order-of-appearance is a deliberate restriction, not an oversight**: a
> `PLATFORM_CONFIRMATION` can only be validated against a Receipt the indexer has
> already seen. A confirmation that arrives before its Receipt is recognized but
> reported `valid: false` (SPEC-008 RF-V11).

## 9. Structural Recognition of Genesis Facts

Genesis facts carry no `OP_RETURN`; they are recognized from output structure.
These rules are the shape half of recognition; the invariants they protect are
SPEC-008 §4.

### 9.1 `IDENTITY_GENESIS`

- **RF-W35** (Events): An identity genesis must have output 0 carrying an NFT with
  `capability = none` and `token.amount = 0`, and must have **one** output
  (legacy form) or **two** (vault form); any other output count must produce no
  fact. In the two-output form, output 1 must be a **tokenless** P2PKH.
- **RF-W36** (Events): In the legacy form the `ownerPkh` must be read from the
  P2PKH locking bytecode of output 0.
- **RF-W37** (Events): In the vault form, the NFT commitment must be exactly 20
  bytes and must equal the `ownerPkh`; the `OP_RETURN`-free output 1 change must
  return to that same `ownerPkh`; `collateral` is the satoshi value of output 0
  and `identityOutpoint` is `txid:0`.

### 9.2 `RECEIPT_GENESIS`

- **RF-W38** (Events): A receipt genesis must have **three** or **four** outputs;
  in the four-output form, output 3 must be a **tokenless** P2PKH change. A fourth
  output carrying a token is not a change and must not be recognized.
- **RF-W39** (Events): Outputs 0, 1 and 2 must each carry an NFT with
  `capability = none` and `token.amount = 0`, all three sharing **one** category.
- **RF-W40** (Events): Output 0 (the Receipt) must have an **empty** commitment
  (legacy form) or a 4-byte/36-byte **interaction context** commitment (RF-W73),
  and be locked to `partyA`'s P2PKH; outputs 1 and 2 (the Rating Rights) must
  each have a **non-empty** commitment. The commitments must be the **cross**
  pair: the Rating Right in output 1 commits to `partyB`'s `pkh` and the one in
  output 2 to `partyA`'s `pkh`; otherwise no fact.
- **RF-W55** (Events): Outputs 1 and 2 must be locked to **two different**
  P2PKH addresses; a receipt genesis whose Rating Rights name the same party must
  not be recognized. The cross pair of RF-W40 does not imply this on its own: when
  both parties are one address, each commitment correctly names the other, so
  RF-W40 is satisfied by a self-receipt. This is a fact about the outputs and is
  required regardless of whether binding verification is applied (SPEC-008
  RF-O821).
- **RF-W58** (Events): Under `0.3.0`, outputs 1 and 2 (the Rating Rights) must be
  locked to a **P2SH32** output (`OP_HASH256 <32> OP_EQUAL`), not to P2PKH, and that
  hash must be the hash of `RatingRightVault` instantiated with the `0x14` constructor
  prefix and one `bytes20` argument, the holder's `pkh` (SPEC-008 RF-O822/RF-O825).
  P2SH32 is the form the CashScript compiler emits for a contract address; a P2PKH
  right, or a P2SH20 one, is the `0.2.x` form and must not be recognized under
  `0.3.0` (RF-W57). Because a P2SH output carries only a hash, the holder is not on
  chain at genesis: it is derived from output 0 (a P2PKH to partyA) and the two
  cross-referencing NFT commitments.
- **RF-W59** (Events): A spend of a tracked Rating Right must be recognized as
  `RATING_ISSUED` only where the spent outpoint was one registered as a
  covenant-locked right (RF-W58) **and** the redeem script revealed by that input
  satisfies binding verification against the canonical `RatingRightVault` bytecode
  instantiated with that holder's `pkh` (RF-W47). A failed verification yields no
  fact (RF-W49), not an unbound one: the "recreate the NFT and rate again" shape is
  exactly what must not be publishable.
- **RF-W73** (Events): A context commitment on output 0 — 4 bytes
  (`0x10 · category · roleA · roleB`) or 36 bytes
  (`0x11 · category · roleA · roleB · contextHash`) — must be decoded into the
  `receiptContext` (`interactionCategory`, `roleA`, `roleB`, and `contextHash`
  for the 36-byte form). The format byte must have high nibble `0x01` and a low
  nibble whose only defined flag is the `HAS_HASH` bit 0 (so exactly `0x10` and
  `0x11` are valid); any other value — including a reserved flag or a length of
  1–3, 5–35 or 37+ bytes, and a 36-byte commitment without `HAS_HASH` — must
  produce **no fact** (tolerant reading: only the shape that is one of the two
  fixed forms is a fact). Unknown `category` or `role` bytes stay on the fact
  raw: they are valid facts whose meaning is application-level (SPEC-008 RF-O10).

## 10. Conformance

- **RF-W41** (Ubiquity): A **recognition-conformant** implementation must satisfy
  §3, §4, §5, §6, §7, §8 and §9: the same raw hex against the same index state
  must produce the same fact, with the same field values, the same `valid`
  result, and the same state transitions as the reference implementation.
- **RF-W42** (Ubiquity): An implementation must not declare recognition
  conformity if it accepts a push encoding rejected by §3, a payload length
  rejected by §4, or a `RATING_ISSUED` without a tracked Rating Right.
- **RF-W43** (Ubiquity): Where an implementation deviates from the reference in
  a **non-normative** layer (storage engine, network, user interface, reputation
  interpretation), the deviation must not change recognition results.
- **RF-W44** (Ubiquity): Conformity must be demonstrated with real executable
  evidence, not with description (Constitution Article 3, SPEC-008 RF-C05).

### 10.1 RF → reference decoder → test matrix

The full rule-to-decoder-to-test mapping is in `REFERENCE-IMPLEMENTATION.md`,
which keeps it out of this specification because the reference implementation is
refactored independently of the protocol.

One obligation belongs here, because it constrains what a recognizer may claim:

- **RF-W28–RF-W34 depend on a durable store.** A recognizer that cannot retain and
  reconstruct the state of SPEC-005 RF-12 cannot satisfy them, regardless of how
  correctly it reads a single transaction.

RF-W01–RF-W05 (container parsing) and RF-W38–RF-W40 (Receipt genesis shape) were
listed here as unverified. They are now covered: 38 tests in the reference SDK
(`op_return_encoding` 23, `receipt_genesis_shape` 15). RF-W45, the truncation
companion to RF-W02, was added at the same time and is covered with them.

Lote 2 (`0.4.0`) adds `RF-W64`–`RF-W76` in §4, §6, §7, §8, §9.2 and §12.3. They
are normative now and **executed** by conformance task E: every row in Annex B.3
is a test in `b3_0_4_0_vectors` (reference SDK), linked to its RF in the
traceability manifest. None of them is claimed as covered without that executed
vector (Constitution Article 3).

## 11. Known Limitations

Declared explicitly per Constitution Article 4 — none of these is a guarantee:

- **The recognizer trusts the network's signature enforcement.** It re-reads a
  public key from a scriptSig and hashes it; it does not verify the signature
  (§5).
- **Determinism is over a single transaction and the current state**, not over a
  re-organization. Confirmations, block ordering and reorg handling are out of
  scope.
- **State is required.** An indexer that starts empty cannot recognize
  `RATING_ISSUED`, `IDENTITY_COLLATERAL_TOP_UP`, `IDENTITY_BURNED` or validate
  `PLATFORM_CONFIRMATION`, because those facts reference a prior tracked
  artifact (§8).
- **Recognition is shape-based, so it is spoofable by an issuer that can produce
  the bytes.** The covenant and the network's script execution are what make a
  fact genuine; the indexer only reads what survived them. This is the gap
  §12 closes, for the two covenant-backed fact types, and it is closed as an
  **optional** verification: a recognizer that does not apply §12 is unchanged by
  it, and §11's statement continues to describe it.
- **`MockNetworkProvider` does not execute the VM nor validate signatures.**
  A transaction accepted by the mock is not proof that its script is correct.
  The "impostor" cases (a P2PKH pretending to be a vault) remain **inconclusive**
  with the currently available tooling (SPEC-005 §6). §12 now settles them by
  construction rather than by executing the impostor: a recognizer that applies
  §12 rejects the impostor from the bytes alone, and the reference SDK's tests
  do exactly that, both against perturbations of a canonical transaction and
  against transactions a real Chipnet node accepted. What remains inconclusive is
  narrower and is restated in §12.6.
- **The contract `fingerprint` is not a recognition input and not a conformance
  anchor.** It does not change when a contract's logic changes (SPEC-005 §6).
- **No automated UI coverage is claimed.** The reference demo's console is
  verified manually, through the guide shipped with that repository.
- **`commentHash` and `contextHash` fidelity is not verifiable on-chain.** The
  recognizer reports the hashes exactly as spent; the correspondence with an
  actual off-chain comment or context is an application claim (SPEC-004 RF-09).
- **Self-corroboration is checked only when both facts are indexed.** A
  `PLATFORM_CONFIRMATION` processed before its Receipt is reported
  `valid: false` (order dependence, §8), and a platform that changes keys
  evades the rule (SPEC-003 RF-10; white paper §14).

## 12. Binding Verification (Optional)

Everything above is shape recognition. It is deliberately permissive, and §11 says
so: CashTokens lets **any** script create a token category, so the outputs of a
canonical genesis can be minted by an impostor that never ran the covenant, and a
shape-based recognizer cannot tell the two apart. §9 even requires a canonical
`RECEIPT_GENESIS` to have exactly the shape an impostor would produce, because the
covenant is what makes the difference and the covenant is what is missing.

This section closes that gap for the two covenant-backed genesis paths **without
running the VM**, and closes it as an *optional* verification.

### 12.1 Why a comparison is possible at all

A P2SH script hash commits to the redeem script that sits in the unlocking
script, so the *script* is on chain even though the *hash* is all the locking
script shows. The obstacle is that both covenants take pkh arguments in their
constructor:

```solidity
contract IdentityVault(bytes20 ownerPkh)
contract ReceiptGenesisValidator(bytes20 partyAPkh, bytes20 partyBPkh)
```

Every deployment is therefore a **different** script and a different script hash.
There is no single constant to compare against. The comparison is nevertheless
exact rather than heuristic, because the pkh values are not guesses: they are the
values the recognizer has already read out of the very outputs it is checking, so
the expected script is fully determined.

- **RF-W46** (Options): An implementation **MAY** verify that a covenant-backed
  fact was produced by the canonical covenant. This verification is **optional**
  and is not part of recognition conformity (RF-W41). A recognizer that does not
  apply it is unaffected by this section, and remains limited by §11 as that
  section states.

### 12.2 The deployed script layout

- **RF-W47** (Ubiquity): Where an implementation applies binding verification, the
  expected redeem script **MUST** be reconstructed as the canonical bytecode of the
  named covenant preceded by its serialized constructor arguments, each argument
  introduced by its own minimal push and in **reverse declaration order** (the
  stack is LIFO), and **MUST NOT** be compared against a single hard-coded script
  hash, because every deployment has a different one. An implementation **MUST NOT**
  derive the expected script from the bytes it is verifying.

  The two layouts in force are `0x14 || ownerPkh || body` for the vault genesis,
  top-up and burn, and `0x14 || partyBPkh || 0x14 || partyAPkh || body` for the
  receipt genesis, where the pkh values are the Rating Right holders read per
  §9.2.
- **RF-W48** (Options): Where an implementation applies binding verification, the
  script hash **MAY** be committed in either of the two P2SH forms — a 35-byte
  `OP_HASH256 <32> OP_EQUAL` or a 23-byte `OP_HASH160 <20> OP_EQUAL` — and the
  implementation **MUST** select the hash function from the width it actually
  found. It **MUST NOT** assume one form and silently fail on the other.
- **RF-W49** (Undesired Behavior): If an implementation applies binding
  verification and the covenant-backed bytes do not match the canonical covenant,
  then it **MUST** emit **no fact** (SPEC-008 RF-V03, RF-C03) — not an error, not
  a partial result, and **not** a fact marked `valid: false`.

  The reason is that `valid: false` already has a different job (RF-W08: a rating
  whose score falls outside 1–5 is still reported, so a consumer can see the
  attempt was made). Reusing it here would assert that the protocol knows about
  this transaction and disapproves of it, when the truth is that it was never a
  RepID transaction. Overloading the flag would leave a consumer unable to tell a
  reported-but-invalid fact from an unrecognized one.
- **RF-W50** (Prohibition): An implementation that applies binding verification
  **MUST NOT** require it of `TRUST_LINK` or `PLATFORM_CONFIRMATION`. Those two are
  plain P2PKH spends carrying an `OP_RETURN`, and they have no covenant to check.
  That is correct rather than a gap: they are unilateral and need no authorization
  beyond the spender's own signature.

  `RATING_ISSUED` was in this list while the Rating Right was a P2PKH output and had
  no covenant to check. It is not any more. Since `0.3.0` the right is locked under
  `RatingRightVault` (SPEC-008 RF-O822/RF-O825), the spend that issues a rating is
  that covenant's only path, and RF-W59 applies binding to it. The prohibition is on
  demanding a covenant that does not exist, not on verification as such: an
  implementation applying binding MUST verify a `RATING_ISSUED` whose input **is** a
  covenant output (RF-W58), and MUST NOT reject one whose input is not.

### 12.3 Which version's bytecode

A canonical bytecode is a property of a protocol version, not of the transaction. The
receipt covenant changed between 0.1.0 and 0.2.0 (SPEC-008 RF-O821 added a
`require`, and a `require` is a byte), so a Receipt broadcast under 0.1.0 reveals a
redeem script that is exactly right for the version that produced it and exactly wrong
for every later one. Nothing on chain says which version minted it.

- **RF-W56** (Prohibition): An implementation that applies binding verification
  **MUST** compare the revealed script against the canonical bytecode of the single
  protocol version it implements, and **MUST NOT** widen the comparison to the
  bytecodes of other versions in order to obtain a match. The applicable version is a
  property of the implementation, not something recovered from the transaction.

  The prohibition is not caution about stale bytecode; it is what keeps the version
  from becoming a sender-chosen parameter. A transaction whose bytes are tested
  against every version the protocol has ever defined binds under whichever version
  the sender finds convenient, and the binding then says nothing that the sender did
  not arrange. An implementation that supports more than one version **MUST** be able
  to name the applicable one without inspecting the bytes under verification — by
  configuration, or by some fact outside those bytes — and **MUST NOT** select it by
  trying until one matches.
- **RF-W57** (Undesired Behavior): Where a covenant-backed fact was minted under a
  protocol version whose canonical bytecode differs from the one the implementation
  implements, binding verification **MUST** emit **no fact** (RF-W49). The
  implementation **MUST NOT** report it as recognized-but-invalid, and **MUST NOT**
  present the mismatch as evidence that the transaction was forged, since a correct
  transaction from an earlier version produces the same bytes.

  This is the intended behaviour and not a defect to be engineered away. The reference
  SDK implements 0.4.0, whose declared covenant set does not include the 0.1.0 receipt
  body (122 bytes; RF-O821 and RF-O825 replaced it), so the Receipt genesis broadcast
  on Chipnet under 0.1.0 is unrecognized by it; §Annex B.2 carries that as a vector,
  and the two identity covenants, which no version changed, bind and act as the
  controls before 0.4.0.
- **RF-W76** (Ubiquity): Where an implementation supports **more than one version**
  of the same covenant — as a `0.4.0` implementation does for the identity vault,
  whose pre-`0.4.0` body (no burn delay) and `0.4.0` body (with the `age >= 144`
  burn gate) coexist — the applicable version for each deployed vault MUST be a
  declared fact of the implementation: configuration, or the version recorded when
  that identity's genesis was recognized. It MUST NOT be selected by trying each
  bytecode until one matches (extends RF-W56 to the same-covenant case). The
  second identity covenant body does not reopen RF-W56: it is recognized only
  through the declared set, never through trial matching (SPEC-008 RF-O831).

### 12.4 What binding does not establish

Binding is a byte comparison, not an execution. It deliberately proves less than
the VM does, and the difference is stated rather than blurred.

- **RF-W51** (Prohibition): Binding verification **MUST NOT** be described as
  verifying signatures, validating scripts, or establishing that a transaction is
  valid in any sense beyond its bytes matching the canonical covenant. It does
  not run the VM (RF-W27) and re-checks nothing the network already enforced.
- **RF-W52** (Options): An implementation that establishes a RepID identity, a
  Receipt or Rating Rights (SPEC-008 RF-V12) **MUST** base that on binding, and
  **MUST NOT** base it on a shape match alone. A recognizer that does not apply
  this section may still report the shape, and must then be understood to make no
  claim about identities at all.
- **RF-W53** (Events): An `IDENTITY_GENESIS` in legacy form (SPEC-008 RF-V13) is
  **out of scope** for this section and **MUST NOT** be rejected by it. There is no
  covenant in that form, so there is nothing to bind, and the fact stays
  recognized exactly as §9.1 requires. An implementation that applies binding must
  therefore distinguish "no covenant to check" from "covenant does not match".

### 12.5 Conformance

- **RF-W54** (Options): An implementation **MAY** declare a **binding-verified**
  capability, separate from recognition conformity (RF-W41), asserting that it
  applies §12 to every fact that has a covenant behind it. It **MUST NOT** declare
  the capability while leaving any covenant-backed path unverified, and the
  declaration **MUST** be accompanied by the executable evidence required by
  RF-W44.

  The capability is separate from RF-W41 on purpose: a binding-verified
  recognizer returns *fewer* facts than a recognition-conformant one, because it
  rejects the impostors RF-W41 does not forbid it from accepting. Conforming to
  §3–§9 and additionally applying §12 are not in tension; they are two different
  claims.

### 12.6 What remains inconclusive

Narrowed from §11, and no wider:

- Binding does not prove the **spend** was legitimate. A top-up or burn is bound by
  comparing the redeem script it reveals, which shows the covenant's bytecode was
  deployed — not that the owner's signature on it was valid. Signature enforcement
  remains the network's (§11, RF-W27).
- Binding establishes which **canonical** covenant produced the bytes, not that the
  covenant's own `require` statements would have been satisfied by this particular
  spend. That remains what the VM is for, and the `debug()` limitation recorded in
  §11 still stands.
- An implementation that does not apply §12 keeps every limitation §11 states for
  it. Declaring the capability is what retires the first.

## Out of Scope

- The event schemas and on-chain invariants (SPEC-008 §3, §4).
- Reputation, Confidence Index, weighting, anti-sybil — non-normative, and owned by an application repository (its SPEC-007).
- Signature verification, and any authentication use of the §5 derivation.
- Reorg handling, confirmation depth, mempool policy.
- Multi-party (>2) interactions and receipts.
- Any modification of the existing facts; recognition is read-only with respect
  to history (SPEC-008 RF-O19).

## Annex A — Reference Decoder Map

Each normative rule and its exemplar in the reference implementation. The
functions live in `repid-sdk`; line numbers are recorded because they are useful
when reading that code, not because they are part of this specification, and they
will drift as the reference is refactored.

| Rule | Function | Lines in the reference |
|---|---|---|
| §3.1 push decoding | `parseOpReturn` | 319–332 |
| §5 declarer derivation | `extractPkhFromUnlocking` | 336–342 |
| §5 P2PKH extraction | `extractP2PKH` | 38–43 |
| §9.1 empty commitment | `recognizeReceiptGenesis` (empty-commitment branch) | `recognize.ts` |
| §9.1 identity genesis | `recognizeIdentityGenesis` | `recognize.ts` |
| §8.1 identity spend | `recognizeIdentitySpend` | `recognize.ts` |
| §9.2 receipt genesis | `recognizeReceiptGenesis` | `recognize.ts` |
| §4.1 rating | `recognizeRatingIssued` | `recognize.ts` |
| §4.2 rating2 (`REPID_RATING2`) | `recognizeRatingIssued` (three-chunk form) | `recognize.ts` |
| §4.3 platform | `recognizePlatformConfirmation` | `recognize.ts` |
| §4.4 trust | `recognizeTrustLink` | `recognize.ts` |
| §4.5 retract (`REPID_RETRACT1`) | `recognizeRatingRetraction` | `recognize.ts` |
| §7 precedence | `indexRawTransaction` | 361–408 |
| §8 state | `createMemoryStore` / `createJsonFileStore` | 419–544 |
| §12.1 expected script | `buildExpectedScript` | `covenant.ts` |
| §12.2 scriptSig reading | `findFinalPush` / `readRedeemScript` | `covenant.ts` |
| §12.2 hash form | `readP2SHHash` | `covenant.ts` |
| §12.2 vault binding | `verifyVaultOutputBinding` | `covenant.ts` |
| §12.2 receipt binding | `verifyRedeemScriptBinding` | `covenant.ts` |

## Annex B — Conformance Vectors and Test Obligations

Constitution Article 3: an RF is not complete without a test. The vectors below
are the ones §3, §4 and §6 require. They are split by whether an automated test
currently exercises them, because listing a covered vector next to an open one
is how a gap goes unnoticed.

### B.1 Covered

| Vector | Expected | Rule | Test |
|---|---|---|---|
| Vault genesis bound to the canonical covenant | `IDENTITY_GENESIS` | RF-W47 | `covenant_binding` |
| Receipt genesis revealing the canonical script, 168 bytes | `RECEIPT_GENESIS` | RF-W47 | `covenant_binding` |
| Vault genesis in the 23-byte `hash160` P2SH form | bound | RF-W48 | `covenant_binding` |
| Redeem script that is not the canonical one | no fact | RF-W49 | `covenant_binding` |
| Redeem script with the right body, wrong constructor arg | no fact | RF-W49 | `covenant_binding` |
| Redeem script with the right body and no constructor arg | no fact | RF-W47 | `covenant_binding` |
| P2PKH output shaped like a vault output | no fact | RF-W49 | `covenant_binding` |
| P2SH output committing to an unrelated script | no fact | RF-W49 | `covenant_binding` |
| `scriptSig` with no final push | no fact | RF-W47 | `covenant_binding` |
| Canonical vault, top-up and burn, over real Chipnet bytes | bound | RF-W47 | `real_chain_binding` |
| `RATING_ISSUED` with no covenant behind it | recognized, **not** rejected | RF-W50 | `real_chain_binding` |
| Rating with a well-formed payload but no tracked right | no fact | RF-W20 | `real_chain_binding` |
| `OP_RETURN` with a `PUSHDATA1` (`0x4c`) push | no fact | RF-W02 | `op_return_encoding` |
| `OP_RETURN` with a `PUSHDATA2` (`0x4d`) push | no fact | RF-W02 | `op_return_encoding` |
| `OP_RETURN` with a `PUSHDATA4` (`0x4e`) push | no fact | RF-W02 | `op_return_encoding` |
| `OP_RETURN` with an `OP_0` (`0x00`) push | no fact | RF-W02 | `op_return_encoding` |
| `OP_RETURN` with a push longer than 75 bytes | no fact | RF-W02 | `op_return_encoding` |
| `OP_RETURN` with a single chunk (tag only) | no fact | RF-W03 | `op_return_encoding` |
| `OP_RETURN` not opened by `0x6a` | no fact | RF-W03 | `op_return_encoding` |
| Tag matched case-insensitively, by prefix or as a prefix | no fact | RF-W04 | `op_return_encoding` |
| Payload chunks merged into one | no fact | RF-W05 | `op_return_encoding` |
| A push declaring more bytes than remain | no fact | RF-W45 | `op_return_encoding` |
| Receipt genesis with 2 or 5 outputs | no fact | RF-W38 | `receipt_genesis_shape` |
| Receipt genesis whose change output carries a token | no fact | RF-W38 | `receipt_genesis_shape` |
| Receipt genesis with capability `mutable` or `minting` | no fact | RF-W39 | `receipt_genesis_shape` |
| Receipt NFTs carrying a fungible amount | no fact | RF-W39 | `receipt_genesis_shape` |
| Receipt NFTs in two different categories | no fact | RF-W39 | `receipt_genesis_shape` |
| Rating Right committing to its own holder | no fact | RF-W40 | `receipt_genesis_shape` |
| Rating Right with swapped commitments | no fact | RF-W40 | `receipt_genesis_shape` |
| Rating Right with an empty commitment | no fact | RF-W40 | `receipt_genesis_shape` |
| Receipt with a non-empty commitment | no fact | RF-W40 | `receipt_genesis_shape` |
| Receipt genesis whose two Rating Rights name the same party | no fact | RF-W55 | `receipt_genesis_shape` |
| `0.2.x` receipt genesis (Rating Rights in P2PKH) read by a `0.3.0` implementation | no fact | RF-W57, RF-W58 | `real_chain_binding` |
| Rating Right recreated as P2PKH in a later transaction | no fact | RF-W58, RF-W59 | `rating_right_covenant` |
| Rating Right spent by an impostor P2SH script with the same constructor arg | no fact | RF-W49, RF-W59 | `rating_right_covenant` |
| Rating Right locked to the canonical covenant, spent once with a well-formed rating | bound | RF-W47, RF-W59 | `rating_right_covenant` |

### B.2 Still open

| Vector | Expected | Rule |
|---|---|---|
| `REPID_RATING1` with a 2-byte payload | no fact | RF-W07 |
| `REPID_RATING1` with 3 chunks | no fact | RF-W05, RF-W07 |
| `REPID_PLATFORM1` with a 20-byte payload (pkh-length) | no fact | RF-W10 |
| `REPID_TRUST1` with a 32-byte payload (txid-length) | no fact | RF-W13 |
| `RATING_ISSUED` with a well-formed payload but **no** tracked right | no fact | RF-W20 |
| `PLATFORM1` / `TRUST1` whose first input has a non-standard unlocking script | no fact | RF-W17 |
| A transaction matching two recognizers at once | the earlier recognizer in §7 wins | RF-W23 |
| `RECEIPT_GENESIS` broadcast under 0.1.0 or 0.2.x, verified by a `0.3.0` implementation | no fact | RF-W49, RF-W56, RF-W57 |

The last vector is a deliberate negative, not an untested case. The Receipt genesis on
Chipnet (`6bb06faf`) was minted under the 0.1.0 covenant, whose body was 122 bytes;
RF-O821 made it 126 and RF-O825 made it a different body again. An implementation of
0.3.0 that compares against an earlier body instead would report it as bound, which
RF-W56 forbids and RF-W57 turns into no fact. The SDK asserts this against the real
transaction — the body does not match, and the reason is reported — and keeps the two
identity covenants, whose bytes no version changed, as the positive controls that
prove the check still binds when it should. Recognizing it is not pending work; under
RF-W56 it is not work this implementation does.

### B.3 `0.4.0` vectors (executed by conformance task E)

| Vector | Expected | Rule | Test |
|---|---|---|---|
| `REPID_RATING2` valid (`byte[1] score + byte[32] commentHash`), right tracked | `RATING_ISSUED` with `commentHash` | RF-W64 | `b3_0_4_0_vectors :: issues a RATING_ISSUED with score and commentHash from a well-formed REPID_RATING2` |
| `REPID_RATING2` with a 1-byte payload | no fact | RF-W65 | `b3_0_4_0_vectors :: emits no fact for a REPID_RATING2 with only the score` |
| `REPID_RATING2` with two chunks (the `REPID_RATING1` shape) | no fact | RF-W65 | `b3_0_4_0_vectors :: emits no fact for a REPID_RATING2 shaped like the two-chunk REPID_RATING1` |
| `REPID_RETRACT1` valid 32-byte reference to a known rating signed by the rater | `RATING_RETRACTION` | RF-W66 | `b3_0_4_0_vectors :: a valid retraction of a rating its signer issued` |
| `REPID_RETRACT1` with a 20-byte payload | no fact | RF-W67 | `b3_0_4_0_vectors :: a retraction whose payload is 20 bytes, not 32` |
| `REPID_RETRACT1` referencing an unknown rating | `valid: false` | RF-W68 | `b3_0_4_0_vectors :: a retraction of a rating this recognizer never saw` |
| `REPID_RETRACT1` from a wallet that is not the rater of the referenced rating | `valid: false` | RF-W69 | `b3_0_4_0_vectors :: a retraction spent by a wallet that is not the rating signer` |
| A second retraction of the same rating | `valid: false` | RF-W70 | `b3_0_4_0_vectors :: a second retraction of an already-retracted rating` |
| Platform confirming a Receipt it is a party to (`platformPkh` ∈ {partyA, partyB}) | `valid: false` | RF-W71 | `b3_0_4_0_vectors :: a party of the Receipt cannot corroborate its own interaction` (positive control: `... a third party who is neither party still corroborates`) |
| Receipt commitment of 4 bytes (`0x10`) with unknown `category`/`role` values | `RECEIPT_GENESIS` with raw `receiptContext` | RF-W73 | `b3_0_4_0_vectors :: decodes a 4-byte 0x10 context, keeping unknown values raw` |
| Receipt commitment of 36 bytes (`0x11`) | `RECEIPT_GENESIS` with `receiptContext.contextHash` | RF-W73 | `b3_0_4_0_vectors :: decodes a 36-byte 0x11 context with its contextHash` |
| Receipt commitment of 1/2/3/5…35 or 37+ bytes, or a reserved format/flag (`0x00`, `0x11`, `0x1f`) | no fact | RF-W73 | `b3_0_4_0_vectors :: rejects every foreign commitment shape` |
| Identity vault `burn()` at `age < 144` | rejected by the VM (covenant), not a recognizer test | RF-O831 | `identity-vault-burn-delay` (6 tests, protocol conformance suite) |
| Identity vault spent with the `0.4.0` body, recorded under its pre-`0.4.0` binding | no fact, per declared set | RF-W76 | `b3_0_4_0_vectors :: rejects a spend revealing the 0.4.0 body for an identity recorded under 0.3.0` |

These vectors are normative in `0.4.0` and were executed by conformance task E
(2026-10-07): the SDK rows run in the reference SDK suite (`b3_0_4_0_vectors`,
18 tests, plus the traceability manifest that links each of them to its RF), and
the `age < 144` row runs in the protocol conformance suite (6 tests, real Bitcoin
VM). Every row above has been run; the two §4.2 rows that falsify RF-W65 share
the RATING2 tag with `REPID_RATING1`, which is the point of the veto.

**Coverage state**: six reference SDK suites back the §3.1 and §9.2 claims,
62 tests between them (`identity_vault_indexer` 5, `issued_rating_and_indexer`
11, `platform_confirmation` 4, `trust_link` 3, `op_return_encoding` 23,
`receipt_genesis_shape` 16). **§3.1 container parsing and §9.2 Receipt genesis
shape are therefore verified**, along with RF-W45, which did not exist when this
annex was first written. The vectors in B.2 remain open. **Lote 2 (`0.4.0`)
adds its own executed state**: `b3_0_4_0_vectors` runs every B.3 row through the
recognizer (`REPID_RATING2`, `REPID_RETRACT1`, self-corroboration,
`receiptContext` and the version-recorded vault binding), `identity-vault-burn-delay`
runs the `age < 144` burn rejection on the Bitcoin VM, and the SDK traceability
manifest links each `RF-W64`–`RF-W76` to its test. The conformance suite
in this repository (`conformance/`) covers the fact schema, the constants and
the specification tooling, not container parsing, and is not a substitute for
the SDK suite.

One caveat on how the §9.2 vectors are reached, because it affects what they
prove. A malformed Receipt cannot be produced through the `receipt_genesis`
covenant: it enforces twenty `require` statements, and CashTokens itself refuses
a `mutable` or `minting` NFT in a genesis, so the builder rejects the
transaction before a recognizer sees it. `receipt_genesis_shape` therefore mints
one canonical Receipt and perturbs the decoded outputs, so each vector differs
from a valid Receipt in exactly one field. These tests show the recognizer
rejects a shape on its own. They do not show the covenant would, because the
covenant never gets the chance — and where the two agree, the recognizer's check
is defense in depth rather than a live gap.

### B.4 Preimage KATs (executed by `conformance/comment-hash-vectors.test.mjs`)

These vectors pin the **byte-exact preimage** of §4.2, the part of the protocol
no recognizer exercises. They are static SHA-256 computations executed by the
protocol conformance suite (real hashes, no VM needed — the covenants never
read these hashes).

| Preimage (hex) | SHA-256 digest |
|---|---|
| `REPID-CMT-V1` (12 B) ‖ `receiptCategory` `5f4c7226…25560b36b0` (32 B) ‖ `raterPkh` `0000…0001` (20 B) ‖ `saltLen` `10` (1 B) ‖ `salt` `a1b2c3d4e5f60718293a4b5c6d7e8f90` (16 B) ‖ `comment` `Top rider, arrived on time` (26 B) | `b73e344beeac85c3136a7e5dc83feb869a9966bd5a3e9540150c29c6e16d4cf4` |

Full preimage bytes (reproducible in
`conformance/comment-hash-vectors.test.mjs`):
`52455049442d434d542d5631 ‖ 5f4c7226b4aa9d9e9dcbf9518e9bbed00e4e44306c2052ce2bd7fa25560b36b0 ‖ 0000000000000000000000000000000000000001 ‖ 10 ‖ a1b2c3d4e5f60718293a4b5c6d7e8f90 ‖ 546f702072696465722c2061727269766564206f6e2074696d65`
(107 bytes).

The `receiptCategory` is the on-chain category of the Receipt the rating
belongs to — recoverable by the rater from the receipt it signed, and by any
reader from the tracked Rating Right. The vector uses the **real** category of
the 2026-09-27 Chipnet fixture (`conformance/fixtures/real-chain-facts.json`),
so the KAT doubles as a real-data anchor rather than a hand-written example.

The interaction `contextHash` deliberately has **no published preimage**
(SPEC-003 RF-08, decision P6 in `audit/lote2/A-DECISIONES.md`), so it has no
vector here. The only context-hash fact recorded in `protocol/constants.json`
is that the `REPID-RCTX-V1` prefix is **13** ASCII bytes — corrected from an
earlier 12-byte claim — and the KAT pins that byte count so a producer copying
the old number does not truncate the prefix; a truncated prefix produces a
digest nothing can verify.
