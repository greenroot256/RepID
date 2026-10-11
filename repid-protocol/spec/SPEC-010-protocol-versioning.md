# SPEC-010: Protocol Versioning

> **Status:** normative. This specification exists because no version identifier
> existed anywhere in RepID before it. A protocol whose meaning can change
> silently is not implementable by a third party with confidence.

## 1. Context and Objective

RepID is a protocol on Bitcoin Cash. A transaction, once broadcast, is immutable
and may be interpreted for years. Therefore **the meaning of a historical event
must never change**.

This specification defines:

1. the version identifier of the protocol;
2. what a version covers;
3. which changes are breaking;
4. how an implementation declares the version(s) it implements;
5. how versions relate to one another.

## 2. The Version Identifier

The protocol version is a three-part semantic version, `MAJOR.MINOR.PATCH`,
recorded machine-readably in `protocol/protocol-version.json`. That file is the
authoritative copy; §6 describes how the version of an individual fact's
*encoding* is identified, which is a separate mechanism.

### Current version

```json
{
  "protocol": "repid",
  "version": "0.5.0",
  "status": "pre-release",
  "specification": {
    "normativeCore": "SPEC-008-repid-protocol.md",
    "wireFormat": "SPEC-009-repid-wire-format-and-recognition.md",
    "recognition": "SPEC-005-indexer-protocol.md",
    "versioning": "SPEC-010-protocol-versioning.md"
  },
  "promotionTo1_0_0": [
    "At least one independent implementation outside this repository has been verified against the recognition rules (SPEC-005) and the wire format (SPEC-009), following the external indexer guide.",
    "The covenant artifacts in artifacts/ have been executed by the Bitcoin VM on a public test network with every invariant in SPEC-008 section 4 asserted, not merely observed."
  ]
}
```

> **Why `0.4.0` and not `1.0.0`.** A leading zero is a promise that the
> specification has *not* yet been validated by an independent implementation.
> That is currently true: the recognition rules have been exercised only by this
> repository's own code. Claiming `1.0.0` would be a claim the project cannot
> yet support (see `constitution.md`, Article 4). The promotion criteria above
> are objective, and moving to `1.0.0` is a one-line change once they are met.
> `0.4.0` is the audited surveillance step of `0.3.0` (SPEC-009 §12.3): it adds
> the identity-vault burn gate, `REPID_RATING2`, `REPID_RETRACT1` and the
> interaction context, and it is read as a superset of `0.3.0` — a compliant
> `0.3.0`-era byte still reads the same under `0.4.0`.
>
> `0.3.0` rather than `0.2.1` because `0.3.0` is a breaking change — the Rating
> Right is now a single-path covenant that destroys the NFT (SPEC-008
> RF-O12/RF-O823), so `ReceiptGenesisValidator` locks both rights to the
> `RatingRightVault` P2SH32 hashes instead of a P2PKH, and a receipt from
> `0.2.x` is no longer recognized (SPEC-009 RF-W56/RF-W57) — and §4 records
> that, during `0.y.z`, a breaking change advances `MINOR`. `0.2.0` was itself
> breaking in the same way, because the receipt covenant began refusing a
> self-receipt (SPEC-008 RF-O821) and the recognizer stopped reporting one
> (SPEC-009 RF-W55).
>
> **On the way to `0.4.0`.** The next breaking change is scheduled as **`0.4.0`**
> in a single step from `0.3.0`, not as `0.3.1`, because audit lot 2 (like lot 1)
> is entirely of class `MAJOR` under §4: it adds a variable-length interaction
> context to the Receipt's NFT commitment (SPEC-003 RF-08, SPEC-009 §9.2), two
> new `OP_RETURN` tags (`REPID_RATING2`, `REPID_RETRACT1`), a new eighth fact type
> (`RATING_RETRACTION`), the identity-vault burn delay (SPEC-008) and the
> self-corroboration rule for platform confirmations (SPEC-003 RF-10). While the
> version is `0.y.z`, a breaking change advances `MINOR` (§4.1), so the whole
> batch lands as the next `MINOR` number, exactly once; the version file is
> updated in task F, never in this audit's diffs.
>
> **`0.5.0`.** The next step disciplined by §4.1: decision P6
> (`audit/lote2/A-DECISIONES.md`) redefines the normative `commentHash` preimage
> — `REPID-CMT-V1` ‖ `receiptCategory` (32 B, display order) ‖ `raterPkh` (20 B)
> ‖ `saltLen` (1 B, 16–32) ‖ `salt` ‖ `comment` (UTF-8 NFC), SHA-256 once
> (SPEC-004 RF-10) — a producer-facing contract that SPEC-009 §4.2 states as
> normative, and therefore a change of class `MAJOR` under §4. While the version
> is `0.y.z`, a `MAJOR`-class change advances `MINOR` (§4.1), so the batch lands
> as **`0.5.0`**. The `contextHash` continues to have **no published preimage**
> (an early draft formula was removed before release), and the byte-length fact
> of its prefix in `protocol/constants.json` is corrected from 12 to **13**. No
> historical fact is read differently: the encoding of every on-chain field, the
> tags and the covenant interfaces are unchanged, so a compliant `0.4.0` reader
> still reads every `0.4.0` byte the same way.

## 3. What a Version Covers

The protocol version covers **everything an independent implementation must
agree on** to reach the same conclusion about a transaction:

| Covered | Not covered |
|---|---|
| `OP_RETURN` tags and payload encoding | Reputation models, confidence indices |
| The field schema of each of the eight facts | Storage, transport, query interfaces |
| Recognition and validation rules (SPEC-005) | Application workflows |
| The on-chain invariants and covenant interfaces (SPEC-008 §4) | Wallet software, key custody |
| The score range (`MIN_SCORE`–`MAX_SCORE`) | Any user interface |

A change to anything in the **Covered** column changes the meaning of
historical data and is therefore breaking.

## 4. Breaking and Non-Breaking Changes

### Breaking — requires `MAJOR`

Any change that would cause a previously valid fact to be read differently, or a
previously recognized shape to stop being recognized:

- adding, removing or renaming a fact type;
- adding, removing or renaming a field of a fact, or changing its encoding;
- changing an `OP_RETURN` tag or the container layout;
- changing the score range;
- changing a covenant interface or an on-chain invariant;
- changing the recognition order or the precedence rules of SPEC-009;
- closing the fact schema (`additionalProperties: false`) or making a previously
  optional field mandatory;
- recognizing a form that the protocol previously refused to recognize (a
  covenant bytecode not previously declared, a payload length that used to be
  invalid, a commitment that used to be empty): the event is breaking in the
  opposite direction, because a historical replay now produces a fact where it
  produced none.

### Non-breaking — requires `MINOR`

Additive changes that leave every historical fact interpretable exactly as
before:

- adding an **optional** field to a fact, which recognizers MUST ignore when
  absent;
- adding a new specification that does not alter existing facts;
- adding edge-case documentation that clarifies, but does not change, a rule.

### Editorial — requires `PATCH`

Typos, formatting, examples, cross-reference fixes. No semantic content.

> **The invariant.** The `MAJOR` number alone guarantees that two facts
> recognized by different versions of the specification can be compared. If a
> change can alter the reading of a historical transaction, it is `MAJOR`.
> There is no exception for "small" changes.

### Before `1.0.0` — a breaking change increments `MINOR`

While the version is `0.y.z`, a change that would constitute a `MAJOR` change
under the rules above MUST increment the **`MINOR`** number and MUST NOT
increment the `PATCH` number.

The reason is that the leading zero is itself the statement that stability is not
yet promised. Semantic versioning treats `0.y.z` as initial development, where
the `MAJOR` field carries no cross-version compatibility guarantee; writing
`1.0.0` or `2.0.0` during that period would assert a stability the specification
has explicitly declined to claim (§2). So a breaking change is recorded as the
next step of a sequence that has not promised stability, rather than in the field
that means "stable".

What this rule preserves:

- **The distinction survives.** A breaking change is still visibly distinct from
  an additive one: it advances `MINOR`, where an additive change advances
  `PATCH`.
- **Monotonicity survives.** Versions never move backwards, and `PATCH` never
  moves without an accompanying `MINOR` step.
- **`1.0.0` stays meaningful.** The first `MAJOR` change made after `1.0.0` is
  `2.0.0`, and no reader has to wonder whether `1.0.0` was skipped.

What it does not preserve: within `0.y.z`, `MINOR` no longer implies "every
historical fact is interpretable as before". That guarantee is only restored at
`1.0.0`, where §7's compatibility rule begins to apply.

`1.0.0` remains reserved for the promotion criteria in `protocol-version.json`.
A breaking change is never itself a reason to promote, and promotion is never a
side effect of one.

## 5. Declaring Implemented Versions

An implementation MUST declare the set of protocol versions it implements, and
MUST NOT claim a version it has not been verified against.

- Before building or recognizing anything, an implementation MUST check that
  the protocol version it is operating under is in its supported set, and MUST
  fail loudly if it is not.
- A recognizer processing historical data spanning a `MAJOR` boundary MUST
  report which version it applied to each fact. It MUST NOT silently apply one
  rule set to data from another.

The declared set MUST be stated **independently of the file it is checked
against**. An implementation that derives its supported set from the very
version file that declares the current version agrees with itself by
construction, and can therefore never catch an unreviewed change. The
declaration exists in order to be able to disagree; a version that arrives
through a sync rather than through a review has to be refused until somebody
adds it deliberately.

> This section states what an implementation must do, not what any particular one
> does. Where the reference implementation satisfies it — which symbols it
> exports, and which test proves the refusal — is recorded in
> `REFERENCE-IMPLEMENTATION.md`, which is non-normative and is refactored
> independently of this specification. Naming a specific API here would make a
> normative document depend on a code detail it does not own, and the
> requirement would then rot silently the first time the code was refactored.

## 6. How the Format Version Is Identified

**The payload of a RepID fact does not carry a version string.** The wire format
is exactly what SPEC-009 §3–§4 defines: a tag followed by a payload, and nothing
else.

The version of a fact's encoding is carried by **the tag itself**. Every tag in
`protocol/constants.json` ends in a revision digit — `REPID_RATING1`,
`REPID_PLATFORM1`, `REPID_TRUST1`, and from `0.4.0` `REPID_RATING2` and
`REPID_RETRACT1` — and that digit *is* the version of that tag's encoding. A
recognizer that has matched a tag therefore already knows which rule
set governs the payload behind it; there is nothing further to read.

This is deliberate, and it is what makes an unknown format safe:

- A tag whose revision a recognizer does not implement matches no recognizer, so
  under SPEC-009 it produces **no fact**. It is not a fact with unreadable
  fields — it is not a fact at all.
- A wrong field interpretation is therefore unreachable. A recognizer cannot read
  `REPID_RATING2` bytes with the `REPID_RATING1` rules, because the tags differ
  and it never applies those rules.
- Guessing remains forbidden on its own terms: a wrong field interpretation is
  indistinguishable, to a third party auditing the fact, from a correct one.

The protocol version `0.4.0` covers the **set** of tags and rules, not an
individual fact. Which specification produced a given fact is not written into
that fact's bytes; it is recovered from the tag, and the tag's revision is what
ties the fact to the specification that defines it.

If a future revision needs to change a payload — more fields, a different
length, a version string inside the payload — it MUST be published as a **new
tag with a new revision digit** and MUST NOT reuse an existing tag. `0.4.0` does
exactly this twice: `REPID_RATING2` for score-plus-`commentHash`, and
`REPID_RETRACT1` for retractions. That is a breaking change under §4 — a `MINOR`
step while the version is `0.y.z`, per §4.1 — and it breaks in both directions: a
recognizer that meets the new tag emits no fact for it until it implements the
new revision.

> **Withdrawn text.** An earlier version of this section specified the payload as
> `<repid-tag> <protocol-version> <payload...>`, with
> `REPID_RATING1 0.1.0 <raterPkh> <rateePkh> <score>` as the concrete case. It
> was never implemented and it contradicts the normative wire format on two
> counts. A `REPID_RATING1` payload is exactly two chunks whose second chunk is
> exactly one byte, so a recognizer is forbidden from reading the rater and the
> ratee out of it — they are recovered from the Rating Right the transaction
> spends, which is the design that lets a rating carry no addresses. And the
> withdrawn text contradicted itself: inserting a version into the payload would
> have changed the number of chunks, and SPEC-009 makes the exact chunk count
> part of the contract. Tag revisions are the versioning mechanism; the payload
> carries no version.

## 7. Compatibility and Migration

- Within a `MAJOR` version, a fact written by any `MINOR`/`PATCH` is readable by
  every implementation of that `MAJOR`. No migration is required.
- Across a `MAJOR` boundary, historical facts are **never rewritten**. They are
  read under the rule set of the version that produced them. There is no
  on-chain migration, because the chain is immutable by design.
- A new `MAJOR` MUST ship alongside the previous one for at least one release
  cycle, so that historical data remains readable during a transition.

## 8. Relation to Implementation Versions

- The **protocol** version (`MAJOR.MINOR.PATCH`) is normative and changes only as
  described above.
- The **SDK** version follows its own semver and is not required to track the
  protocol version numerically. Its compatibility is expressed by
  `SUPPORTED_PROTOCOL_VERSIONS`, not by matching numbers.
- The **demo application** is not versioned against the protocol; it consumes an
  SDK and declares the SDK version it was built with.

## 9. Out of Scope

- Wallet and key-management versioning.
- Wallet software, exchanges and explorers: they version independently.
- Application-level protocol extensions. An application that needs extra events
  MUST define them outside this protocol and MUST NOT alter the meaning of a
  RepID fact.
