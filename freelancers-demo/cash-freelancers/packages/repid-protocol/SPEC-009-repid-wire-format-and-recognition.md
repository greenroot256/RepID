# SPEC-009: RepID Wire Format and Recognition

> **Status**: normative. This spec defines the byte-level contract of RepID's
> `OP_RETURN` facts and the deterministic algorithm that recognizes them. It
> **complements** SPEC-008 §5; it does not replace it. Where both speak, they
> must agree, and any divergence is a defect in one of them.
>
> **Precedence**: `constitution.md` > SPEC-008 > **SPEC-009** > SPEC-001 through
> SPEC-007. Those earlier specs remain as *rationale* per feature.
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
  scope and remain non-normative (SPEC-008 §6, SPEC-007). Nothing in this spec
  may be used to justify a score on-chain.
- **Signature validity is never re-checked** by a conformant recognizer. The
  network verified the spends; the indexer only reads shapes.

## 2. Notation and Byte Conventions

- `0x` prefixes a **raw byte** literal; all other string values in an
  `OP_RETURN` are UTF-8 (SPEC-008 §4.7).
- `byte[n]` is a payload of exactly `n` bytes. A length mismatch is never
  tolerated silently: it produces **no fact** (§4.4).
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
- Reference decoder: `packages/indexer/src/repid-indexer.mjs`. Its helpers
  `parseOpReturn` (line 319), `extractPkhFromUnlocking` (line 336),
  `extractP2PKH` (line 38) and `isEmptyBytes` (line 45) are the normative
  exemplars; Annex A maps each rule to them.

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

Three tags are defined. Their values are published as
`REPID_RATING_TAG`, `REPID_PLATFORM_TAG` and `REPID_TRUST_TAG` from
`@repid/protocol`.

| Tag | Chunks | Payload | Meaning |
|---|---|---|---|
| `REPID_RATING1` | exactly 2 | `byte[1]` | score issued by the rater |
| `REPID_PLATFORM1` | exactly 2 | `byte[32]` | `txid` of the validated Receipt |
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

### 4.2 `REPID_PLATFORM1` — platform confirmation

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

### 4.3 `REPID_TRUST1` — trust link

- **RF-W12** (Events): When a transaction's `OP_RETURN` carries exactly two
  chunks with tag `REPID_TRUST1`, the second chunk of exactly 20 bytes must be
  interpreted as the `trustedPkh`, in display order.
- **RF-W13** (Undesired Behavior): If the payload is not exactly 20 bytes, the
  recognizer must emit no fact.
- **RF-W14** (Undesired Behavior): If `trustedPkh` equals the resolved
  `trusterPkh`, the fact must be emitted with `valid: false` (self-trust,
  SPEC-006, SPEC-008 RF-O17).

### 4.4 Malformed vs invalid

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

- **RF-W19** (Events): When a `REPID_RATING1` payload is well-formed, the
  recognizer must resolve `raterPkh` and `rateePkh` by looking up, for each
  input of the transaction, whether its outpoint (`txid:vout`) is a tracked
  Rating Right; `raterPkh` must be that right's `ownerPkh` and `rateePkh` must
  be its `ratesPkh`.
- **RF-W20** (Undesired Behavior): If no input of the transaction spends a
  tracked Rating Right, the recognizer must emit **no fact**. A bare
  `REPID_RATING1` `OP_RETURN` with no matching right is a non-fact
  (SPEC-008 RF-V03).
- **RF-W21** (Events): When the Rating Right is resolved, the recognizer must
  remove that outpoint from the tracked set, because its spend implicitly burns
  the NFT and thereby consumes the right (SPEC-008 RF-O12, RF-V05).
- **RF-W22** (Ubiquity): The recognizer must **not** read `raterPkh` or
  `rateePkh` from the `OP_RETURN` payload; a rating payload is one byte and
  carries no addresses by design.

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
  | 6 | trust link | `TRUST_LINK` | — |

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
- **RF-W32** (Events): On `RATING_ISSUED`, the indexer must remove the consumed
  Rating Right outpoint.
- **RF-W33** (Undesired Behavior): If a collateral fact does not preserve the NFT
  category and commitment, or if the new collateral is lower than the registered
  one, the indexer must emit the fact with `valid: false` and must not advance
  the tracking to an invalid state (SPEC-008 RF-V09).
- **RF-W34** (Ubiquity): The indexer must persist this state so that recognition
  survives a process restart (SPEC-008 RF-V10). The reference implementation uses
  a local JSON file via `createJsonFileStore`.

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
- **RF-W40** (Events): Output 0 (the Receipt) must have an **empty** commitment and
  be locked to `partyA`'s P2PKH; outputs 1 and 2 (the Rating Rights) must each
  have a **non-empty** commitment. The commitments must be the **cross** pair: the
  Rating Right in output 1 commits to `partyB`'s `pkh` and the one in output 2 to
  `partyA`'s `pkh`; otherwise no fact.

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

| RF | Reference decoder (`packages/indexer/src/repid-indexer.mjs`) | Backing test |
|---|---|---|
| RF-W01–RF-W05 | `parseOpReturn` (line 319) | **none yet** — see Annex B |
| RF-W06–RF-W08 | `tryDecodeIssuedRating` (line 229) | `packages/indexer/test/issued_rating_and_indexer.test.js` |
| RF-W09–RF-W11 | `tryDecodePlatformConfirmation` (line 267) | `packages/indexer/test/platform_confirmation.test.js` |
| RF-W12–RF-W14 | `tryDecodeTrustLink` (line 295) | `packages/indexer/test/trust_link.test.js` |
| RF-W16–RF-W18 | `extractPkhFromUnlocking` (line 336) | indirect: `platform_confirmation.test.js`, `trust_link.test.js` |
| RF-W19–RF-W22 | `tryDecodeIssuedRating` + `store.getRatingRight` | `packages/indexer/test/issued_rating_and_indexer.test.js` |
| RF-W23–RF-W27 | `indexRawTransaction` (line 361) | `test/e2e_server.test.js` (partial) |
| RF-W28–RF-W34 | `createMemoryStore` / `createJsonFileStore` | `packages/indexer/test/identity_vault_indexer.test.js`, `issued_rating_and_indexer.test.js` |
| RF-W35–RF-W37 | `tryDecodeIdentityGenesis` (line 67) | `packages/indexer/test/identity_vault_indexer.test.js` |
| RF-W38–RF-W40 | `tryDecodeReceiptGenesis` (line 178) | **none yet** — see Annex B |

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
  fact genuine; the indexer only reads what survived them.
- **`MockNetworkProvider` does not execute the VM nor validate signatures.**
  A transaction accepted by the mock is not proof that its script is correct.
  The "impostor" cases (a P2PKH pretending to be a vault) remain **inconclusive**
  with the currently available tooling (see `AGENTS.md` §7).
- **No automated UI coverage is claimed**; the console is verified manually via
  `docs/TESTING.md`.

## Out of Scope

- The event schemas and on-chain invariants (SPEC-008 §3, §4).
- Reputation, Confidence Index, weighting, anti-sybil (SPEC-007, non-normative).
- Signature verification, and any authentication use of the §5 derivation.
- Reorg handling, confirmation depth, mempool policy.
- Multi-party (>2) interactions and receipts.
- Any modification of the existing facts; recognition is read-only with respect
  to history (SPEC-008 RF-O19).

## Annex A — Reference Decoder Map

Each normative rule and its exemplar in the reference implementation:

| Rule | Function | Lines |
|---|---|---|
| §3.1 push decoding | `parseOpReturn` | 319–332 |
| §5 declarer derivation | `extractPkhFromUnlocking` | 336–342 |
| §5 P2PKH extraction | `extractP2PKH` | 38–43 |
| §9.1 empty commitment | `isEmptyBytes` | 45–49 |
| §9.1 identity genesis | `tryDecodeIdentityGenesis` | 67–103 |
| §8.1 identity spend | `tryDecodeIdentitySpend` | 117–176 |
| §9.2 receipt genesis | `tryDecodeReceiptGenesis` | 178–215 |
| §4.1 rating | `tryDecodeIssuedRating` | 229–259 |
| §4.2 platform | `tryDecodePlatformConfirmation` | 267–288 |
| §4.3 trust | `tryDecodeTrustLink` | 295–314 |
| §7 precedence | `indexRawTransaction` | 361–408 |
| §8 state | `createMemoryStore` / `createJsonFileStore` | 419–544 |

## Annex B — Conformance Vectors and Test Obligations

The following vectors are **required** by §3, §4 and §6 but are **not yet
covered** by an automated test (Constitution Article 3: an RF is not complete
without a test). They are recorded here as open obligations, not as passing
results.

| Vector | Expected | Rule |
|---|---|---|
| `OP_RETURN` with a `PUSHDATA1` (`0x4c`) push | no fact | RF-W02 |
| `OP_RETURN` with `PUSHDATA2` (`0x4d`) / `PUSHDATA4` (`0x4e`) | no fact | RF-W02 |
| `OP_RETURN` with an `OP_0` (`0x00`) push | no fact | RF-W02 |
| `OP_RETURN` with a single chunk (tag only) | no fact | RF-W03 |
| Tag matched case-insensitively or by prefix | no fact | RF-W04 |
| `REPID_RATING1` with a 2-byte payload | no fact | RF-W07 |
| `REPID_RATING1` with 3 chunks | no fact | RF-W05, RF-W07 |
| `REPID_PLATFORM1` with a 20-byte payload (pkh-length) | no fact | RF-W10 |
| `REPID_TRUST1` with a 32-byte payload (txid-length) | no fact | RF-W13 |
| `RATING_ISSUED` with a well-formed payload but **no** tracked right | no fact | RF-W20 |
| `PLATFORM1` / `TRUST1` whose first input has a non-standard unlocking script | no fact | RF-W17 |
| A transaction matching two recognizers at once | the earlier recognizer in §7 wins | RF-W23 |

**Coverage state at the time of writing**: the reference indexer ships 23
tests (`identity_vault_indexer` 5, `issued_rating_and_indexer` 11,
`platform_confirmation` 4, `trust_link` 3). The vectors above are additional
work, tracked in `tasks.md`.
