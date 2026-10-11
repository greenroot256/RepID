# RepID — White Paper

**RepID is a protocol for reputation on Bitcoin Cash that records what happened
and leaves the judgment to you.**

| | |
|---|---|
| **Protocol version** | `0.5.0` (pre-release) |
| **Network** | Bitcoin Cash (BCH) |
| **Technologies** | CashTokens, CashScript |
| **Status** | Normative specification, canonical covenants and a conformance suite |
| **License** | MIT |
| **Repository** | `greenroot256/repid-protocol` |

> **How to read this document.** Every section below ends with a `Source:` line
> naming the normative file it comes from. RepID keeps its documentation
> traceable on purpose: a claim in a white paper is worth nothing if nobody can
> check it. Where the protocol does something, this document names the file that
> says so. Where the protocol does **not** do something, it says that too.
>
> This document describes the **protocol**, not any particular product. Nothing
> here requires you to use a specific wallet, indexer or application.

---

## 1. The one idea

**The blockchain stores immutable facts. The interpretation of those facts
stays off-chain.**

This single decision is what RepID is. RepID writes eight kinds of things into
the Bitcoin Cash blockchain: that an identity was created, that its collateral
was increased, that it was burned, that a receipt was issued for an interaction,
that a rating was given, that a rating was subsequently retracted by the same
rater, that a platform corroborated that interaction, and that one person
declared trust in another.

What it deliberately does **not** write is a verdict. How reputable someone is,
how much their word is worth, how their ratings should be weighted — none of
that is decided on-chain. That calculation belongs to whoever wants to make it,
and two different people are free to make two different calculations from the
exact same facts without disagreeing about the facts.

The chain is the part that cannot be quietly changed. So the protocol's job is
to make that part unambiguous, verifiable by anyone, decades later, without
needing permission from the people who built it.

> Source: `constitution.md` Article 1; `spec/SPEC-008-repid-protocol.md` §1;
> `README.md`.

---

## 2. The problem RepID is built around

Most online reputation systems have the same structural weakness: the record of
who did what belongs to whoever operates the system. Users can appeal, but they
cannot verify. The history is a database, not a proof.

Moving reputation onto a public blockchain creates a different set of
problems, and RepID is designed around them explicitly:

- **Who controls the record?** If a central party keeps the ledger, the ledger is
  only as trustworthy as that party.
- **Who decides what is "good"?** A number stored on-chain is a number everyone
  must accept, even when it was produced by one party's private formula.
- **What happens when a record is wrong?** Published history is hard to correct
  without destroying the value of having published it.
- **What is a fact, anyway?** A claim, an opinion, and a measured quantity look
  identical if nobody defines them.

RepID's answers are structural rather than procedural:

1. There is no authority that issues, approves or cancels anything. Validity is
   *deduced from the chain* — from who signed what, and from rules enforced by
   the Bitcoin Virtual Machine.
2. No on-chain artifact may contain a value judgment. Scores stay off-chain.
3. Facts are never edited or deleted. Something can *become invalid* without its
   history disappearing. Since `0.4.0`, a rating can be **retracted**: the
   original fact stays on the chain, and a new fact — `RATING_RETRACTION`, an
   `OP_RETURN` spent by the same rater — counters it. Correct without erasing;
   the verdict stays with whoever interprets the facts.
4. Every fact has a published, byte-level definition, so "a fact" is a
   testable claim rather than a judgement call.

> Source: `spec/SPEC-008-repid-protocol.md` §1, §2, §4.6, §7;
> `constitution.md` Articles 1 and 2.

---

## 3. Guiding principles

These are the project's non-negotiable rules. They outrank every
specification, and several of them exist specifically to keep the protocol
honest.

**1. Facts on-chain, interpretation off-chain.** No covenant may contain
composite scoring, weighting or any value judgment. That responsibility belongs
to the layers above.

**2. No central authority.** Nothing in the protocol can be issued, approved or
revoked by an operator. If a rule requires someone's permission, it is not part
of the protocol.

**3. Facts are immutable.** An emitted fact is never rewritten. A burned
identity stops being valid; the transaction that created it stays in the record
forever.

**4. Explicit authorization.** Spending value or a right always requires the
signature of whoever controls it. An operation involving two parties requires
both signatures.

**5. Simplicity over complexity.** The simplest design that satisfies the
current requirement wins. Bitcoin Cash already guarantees that a UTXO can only
be spent once and that a token's category comes from a specific output — those
native guarantees are used *before* writing any custom contract logic. For
example, RepID does not use a commit-reveal scheme for ratings, because the
receipt is already signed by both parties before any rating exists; adding
hiding would be complexity with no benefit.

**6. No mandatory score.** The protocol defines no reputation algorithm and no
normative trust value.

**7. Tests before code.** A requirement is not implemented until a test derived
from its acceptance criteria exists and has actually been run.

**8. Radical honesty.** No test result is reported without having been run.
Tooling limitations are documented, never omitted. A claim that cannot be
verified with the available tools is removed from the artifact rather than left
in as "almost true".

**9. "Out of scope" is law.** Anything marked out of scope is not implemented
until a new version of a specification explicitly includes it. This is the main
defence against scope creep.

**10. The specification is the product.** Code and specification are kept
synchronized in both directions. A change in behaviour without a change in
`spec/` is an incomplete change.

> Source: `constitution.md`, Articles 1–10.

---

## 4. Who is involved

RepID defines seven entities. Six of them are anchored on-chain — either as a
locked token or as a transaction that spends one. The interaction itself is
application metadata: the interaction never touches the chain. What CAN touch
the chain, since `0.4.0`, is a small **interaction context** inside the Receipt's
commitment — an interaction category, both roles and, optionally, a context hash
(SPEC-008 RF-O10, SPEC-009 §9.2) — that names the *kind* of interaction and each
party's role while keeping whatever the parties actually exchanged off-chain.

| Entity | What it is | Where it lives | Key data |
|---|---|---|---|
| **Identity** | An immutable token plus collateral in BCH | A covenant output (vault), or in the legacy form directly in a P2PKH output | category, owner hash, collateral |
| **Interaction** | Metadata about what two parties did; the interaction itself never enters the chain | Off-chain; since `0.4.0` the Receipt MAY anchor its context (category + roles [+ contextHash]) | roles, both party hashes, a protocol reference |
| **Receipt** | An immutable token proving an interaction was acknowledged | Output 0 of its genesis transaction | category, holder (= party A) |
| **Rating Right** | A single-use token, one per party per receipt | Outputs 1 and 2 of the receipt's genesis | who holds it, who it entitles them to rate |
| **Rating** | A score given by spending a Rating Right | The transaction that spends it | rater, ratee, score |
| **Platform validation** | A third party confirming an interaction happened | That validator's own P2PKH transaction | validator, receipt's transaction id |
| **Trust Link** | A unilateral statement of trust | The declarer's own P2PKH transaction | who declared, who was trusted |

**Terms used throughout.** A **pkh** is a 20-byte hash of a public key; it
identifies whoever controls a piece of value. A **category** is the 32-byte
identifier of a CashToken. A **commitment** is a data field inside a token. A
**UTXO** is an unspent transaction output — the unit of spendable value on
Bitcoin Cash. A **covenant** is a smart contract that locks a UTXO and
restricts how it may be spent. A **txid** is the 32-byte identifier of a
transaction.

### Relationships that hold

- An interaction always has **exactly two distinct parties**, each with an
  explicit role.
- A receipt corresponds to exactly one interaction and fixes exactly two
  parties.
- Each receipt creates **exactly two Rating Rights** — one for each party, and
  each naming the *other* party as the one it entitles them to rate.
- A Rating Right produces **at most one rating**: spending it consumes it.
- Since `0.4.0`, a rating can be **retracted** unilaterally by the rater: the
  retraction is a new fact, not an edit of the original rating.
- An identity can receive and issue any number of ratings, validations and
  trust links. The protocol sets no quantity limit.
- A Trust Link is **unilateral**. It requires neither the other party's consent
  nor an identity, and it does not enable rating.
- A platform validation **references** a receipt without altering it.

> Source: `spec/SPEC-008-repid-protocol.md` §2, §2.1, Annex B.1.

---

## 5. The eight facts

The protocol defines exactly eight fact types. A **fact** is a structured record
reconstructed from a transaction; the fields below are normative, and they are
also published as a machine-readable JSON Schema.

| # | Fact | What it asserts |
|---|---|---|
| 1 | `IDENTITY_GENESIS` | An identity was created, and for whom |
| 2 | `IDENTITY_COLLATERAL_TOP_UP` | An identity's collateral was increased |
| 3 | `IDENTITY_BURNED` | An identity was burned |
| 4 | `RECEIPT_GENESIS` | A receipt and its two Rating Rights were created |
| 5 | `RATING_ISSUED` | A rating was given, by whom, to whom, and with what score |
| 6 | `RATING_RETRACTION` | A rater unilaterally retracted one of its earlier ratings |
| 7 | `PLATFORM_CONFIRMATION` | A platform corroborated that an interaction occurred |
| 8 | `TRUST_LINK` | One person declared trust in another |

**The full field set of each fact:**

- **`IDENTITY_GENESIS`** — `txid`, `identityCategory`, `ownerPkh`; in vault form
  also `collateral` (a string, in satoshis) and `identityOutpoint`.
- **`IDENTITY_COLLATERAL_TOP_UP`** — `txid`, `identityCategory`, `ownerPkh`,
  `spentOutpoint`, `previousCollateral`, `collateral`, `valid`.
- **`IDENTITY_BURNED`** — `txid`, `identityCategory`, `ownerPkh`,
  `spentOutpoint`, `valid`.
- **`RECEIPT_GENESIS`** — `txid`, `receiptCategory`, `receiptOwnerPkh`,
  `ratingRights[]` with two entries of `{outpoint, ownerPkh, ratesPkh}`; in
  `0.4.0` it may also carry `receiptContext` (`interactionCategory`, `roleA`,
  `roleB`, optional `contextHash`).
- **`RATING_ISSUED`** — `txid`, `spentOutpoint`, `raterPkh`, `rateePkh`,
  `score`, `valid`; under the `REPID_RATING2` container it also carries
  `commentHash`.
- **`RATING_RETRACTION`** — `txid`, `raterPkh`, `receiptTxid`, `valid` (the
  receipt whose rating is being retracted). The original `RATING_ISSUED` is
  never deleted; the chain records, it does not rescind.
- **`PLATFORM_CONFIRMATION`** — `txid`, `platformPkh`, `receiptTxid`, `valid`.
- **`TRUST_LINK`** — `txid`, `trusterPkh`, `trustedPkh`, `valid`.

### What the relationships between facts mean

- An identity exists in protocol terms **only** if its genesis was recognized.
- A top-up and a burn only exist relative to an already-tracked identity, and
  they cannot both happen in the same vault spend.
- The receipt genesis is the **only** event that creates Rating Rights.
- A rating exists **only** if it spends a Rating Right. The right's holder is the
  rater; the counterparty named in the right is the ratee.
- A rating retraction references the rating of **one** receipt, is unilateral
  (only the rater can spend its own funds with `REPID_RETRACT1`), and can
  retract a given rating at most once. Retracting does not delete the rating; it
  publishes a counter-fact that interpreters weigh.
- A platform confirmation is valid only if the receipt it references is already
  known to the indexer.
- A Trust Link is independent of everything else: it needs no prior identity and
  no prior interaction.

### Core versus extensions

RepID is deliberately layered, so that a minimal adopter can ignore half of it:

| Layer | Contents |
|---|---|
| **Core** | Identity (genesis, top-up, burn), Receipt, Rating Right, Rating (`RATING_ISSUED` and, since `0.4.0`, `RATING_RETRACTION`; a `commentHash` is part of `RATING_ISSUED`, not a separate fact) |
| **Extensions** | Platform confirmation, Trust Link |
| **Outside the protocol** | Reputation, confidence indices, anti-sybil rules, user interfaces, storage |

> Source: `spec/SPEC-008-repid-protocol.md` §3, §3.1, §3.2, §8.1;
> `protocol/schemas/repid-fact.schema.json`; `protocol/constants.json`.

---

## 6. The on-chain components

### 6.1 The token rules everything shares

Identities, receipts and Rating Rights are all **CashTokens NFTs** with two
properties fixed by the protocol:

- **Capability `none`** — the token can never be mutated or re-minted. Once
  created, the category cannot be reissued.
- **Amount `0`** — the token carries no associated fungible balance.

Both also obey the CashTokens genesis rule: the token's **category is the
transaction id of the outpoint being spent**, and that outpoint must come from
**output 0**. This is not a RepID invention; it is the native rule of the token
standard, and RepID relies on it rather than inventing its own identifier scheme.

### 6.2 `IdentityVault` — the identity and its collateral

The canonical identity form locks the identity token inside a covenant together
with a **collateral amount in BCH**. The behaviour is deliberately close to that
of a bank account:

| Operation | What it does |
|---|---|
| `mint` | Creates the identity. Output 0 holds the identity token (whose commitment is the owner's public-key hash) plus the initial collateral, re-locked to the same covenant. Output 1 is the owner's change, carrying no tokens. |
| `increaseCollateral` | The owner adds funds. The covenant re-locks the same token, and the new value **must be at least** the value being spent. |
| `burn` | The token does not reappear in any output, and the entire balance returns to the owner's ordinary address. The identity loses validity; the owner can mint a new one. |

Three properties are worth stating plainly, because they are enforced by the
Bitcoin VM and not by goodwill:

- **Only the owner can act.** Every path requires the owner's signature.
- **Collateral can only grow.** The covenant does not store a number; it infers
  the collateral from the value of the output locking it, and requires the next
  value to be at least as large.
- **The token never escapes.** The token is always re-locked to the same
  covenant, except on `burn`, where it is destroyed.

The collateral is a self-custodied economic commitment, not a fee to anyone. It
stays under the owner's own control and returns to them intact if they burn the
identity.

Since `0.4.0`, `burn` also requires the vault to have lived for **144 blocks**
(about a day on BCH) before it can be destroyed, giving counterparties a window
to read the identity before its collateral can walk away. The delay is enforced
by the covenant itself (`this.age`, SPEC-008 RF-O831), not by the indexer. It
applies **only to `burn`**: `increaseCollateral` is never delayed, and a top-up
itself **restarts the clock**, because the age is the age of the UTXO being
spent and the re-lock creates a new output (SPEC-008 RF-O831).

### 6.3 `IdentityGenesisValidator` — the legacy form

An earlier, simpler form locked the identity token straight to a P2PKH output
with no collateral. RepID still reads it — historical facts must remain
interpretable — but the vault form is the canonical one.

### 6.4 `ReceiptGenesisValidator` — the anti-corruption layer

This is where the protocol earns its name as a reputation system rather than a
database. A receipt is minted in **one transaction that requires both parties'
signatures**, and it creates three tokens at once:

| Output | What it is | Commitment |
|---|---|---|
| 0 | The receipt itself, locked to party A | *empty*, or an interaction context (`0.4.0`) |
| 1 | Party A's Rating Right, locked to `RatingRightVault` (the P2SH32 address derived from party A's pkh) | party B's public-key hash |
| 2 | Party B's Rating Right, locked to `RatingRightVault` (the P2SH32 address derived from party B's pkh) | party A's public-key hash |
| 3 | Change back to party A (four-output form only; a three-output genesis has no change) | *no tokens* |

The **cross pattern** in the commitments is the mechanism: a Rating Right is
literally "my right to rate that specific person", and the other party cannot
forge it, because creating it required their own signature.

Since `0.4.0`, the receipt may also carry an **interaction context** in its own
commitment: a 4-byte form (`0x10` — interaction category plus the two roles) or
a 36-byte form (`0x11` — adding a context hash). The category and the roles
travel on-chain; what those bytes *mean* for the two parties stays off-chain,
declared by the interaction protocol (SPEC-009 §9.2, RF-W73).

The Rating Rights are not plain P2PKH outputs. Each one is locked inside the
**`RatingRightVault`** covenant, a P2SH32 contract address (SPEC-008
RF-O822/RF-O825), and the covenant exposes **exactly one spend path**, which
destroys the NFT (SPEC-008 RF-O823). The "one rating per party per interaction"
guarantee is therefore a **covenant rule**, not a single-spend assumption
(SPEC-008 RF-S01): the chain's single-spend rule alone would not stop a P2PKH
holder from re-issuing the token in its own spend. **Spending the right *is* the
rating, and it *is* the destruction of the right.**

### 6.5 Ratings, platform confirmations and trust links

The **rating** spends the `RatingRightVault` covenant introduced above (SPEC-008
RF-O823). The other three — the **retraction**, the **platform confirmation**
and the **trust link** — need no covenant: each one is a normal P2PKH spend of
the declarer's own funds that includes a small, precisely formatted data output:

| Fact | Who spends | What it declares |
|---|---|---|
| Rating | The holder of a Rating Right | A score from 1 to 5, plus (under `REPID_RATING2`) the hash of an off-chain comment |
| Rating retraction | A rater, using its own funds | "I retract my earlier rating of this receipt" |
| Platform confirmation | A validating platform, using its own funds | "I corroborate that the receipt with this transaction id happened" |
| Trust Link | Any wallet, using its own funds | "I declare trust in this public-key hash" |

The deliberate consequence: **a platform confirmation and a trust link cost
real money to publish**, because the declarer spends their own output. That is
the only cost the protocol imposes, and it is a network fee, not a fee to any
authority.

> Source: `contracts/identity_vault.cash`, `contracts/receipt_genesis.cash`,
> `contracts/identity_genesis.cash`; `spec/SPEC-008-repid-protocol.md` §4.1–§4.5;
> `spec/SPEC-001-identity-protocol.md`; `spec/SPEC-003-interaction-receipt-protocol.md`;
> `spec/SPEC-004-rating-protocol.md`.

---

## 7. How a fact travels on the wire

A protocol that says "an `OP_RETURN` with a tag" is not yet a protocol. RepID
specifies the encoding **byte by byte**, so that an independent implementation
can produce and read the same bytes.

`OP_RETURN` is the Bitcoin script opcode that marks an output as
non-spendable data. RepID uses it for the declared facts — ratings (two tags,
one fact), platform confirmations, trust links and, since `0.4.0`, rating
retractions. The two *genesis* facts — identity creation and receipt creation —
carry no data output at all; they are recognized from the structure of their
outputs, which is arguably stronger, because the structure is enforced by the
token standard and the VM.

### 7.1 The container

A RepID data output is `0x6a` followed by a series of **direct pushes**, one
introducing the tag and one introducing the payload.

The reading rules are strict, and deliberately unforgiving, because a lenient
reader is how a look-alike gets mistaken for a fact:

- Only **direct pushes** are accepted — a one-byte length opcode introducing
  exactly that many bytes.
- Any other push form is rejected, including zero-length pushes and pushes
  longer than 75 bytes.
- If a push **claims more bytes than the script actually contains**, the whole
  output is rejected. This case is called out separately because a reader that
  simply slices out the requested length will silently accept a truncated
  output — and a truncated rating payload *is* a valid score.
- At least **two** pushes are required: the tag and a payload.
- The tag is compared by **exact byte equality** — never by prefix, never
  case-insensitively.
- The number of chunks and the exact length of each are validated **before**
  anything is read out of them. Chunks are never concatenated first.

The same strict reading applies to the `0.4.0` payloads: `REPID_RATING2`
requires exactly three chunks whose third is exactly 32 bytes, and
`REPID_RETRACT1` exactly two with the second exactly 32 bytes — anything else is
no fact (SPEC-009 §4.2, §4.5).

### 7.2 The five tags and their payloads

| Tag | Tag length | Chunks | Payload | Meaning |
|---|---|---|---|---|
| `REPID_RATING1` | 13 bytes | exactly 2 | exactly 1 byte | The score, 1–5 |
| `REPID_RATING2` | 13 bytes | exactly 3 | exactly 1 + 32 bytes | The score, 1–5, plus a hash of an off-chain comment |
| `REPID_PLATFORM1` | 15 bytes | exactly 2 | exactly 32 bytes | The transaction id of the receipt |
| `REPID_RETRACT1` | 14 bytes | exactly 2 | exactly 32 bytes | The transaction id of the rated receipt whose rating is retracted |
| `REPID_TRUST1` | 12 bytes | exactly 2 | exactly 20 bytes | The trusted party's public-key hash |

A detail worth pausing on: **the `REPID_RATING1` payload is a single byte and
contains no addresses** — `REPID_RATING2` adds a 32-byte `commentHash` to the
same one-byte score. The rater and the ratee are not stated in the data output
at all. They are recovered from the Rating Right that the transaction spends —
whose holder is the rater and whose commitment names the ratee. Any
implementation that tried to read the participants out of the rating payload
would be non-conformant, and the specification says so explicitly.

The comment behind a `commentHash` is **never on-chain**: it is delivered by
agreement between the rater and whoever reads the fact, and the protocol commits
to its hash so that "this comment was attached to this score" is checkable
without being forged by whoever last touched the comment (SPEC-004 RF-08/RF-09).
The preimage is normative and salted, and it **binds the utterance to the Receipt
it rates** by hashing that Receipt's on-chain `receiptCategory`:
`commentHash := SHA256('REPID-CMT-V1' ‖ receiptCategory ‖ raterPkh ‖ saltLen ‖ salt ‖ comment)`
with a 16–32 byte `salt` that travels with the comment, never on-chain (SPEC-004
RF-10/RF-11, `protocol/constants.json`). The salt is what keeps the comment's
hash unguessable when the text is short or predictable; the `receiptCategory`
makes the same comment and score non-reusable across two interactions of the
same rater.

The interaction `contextHash` (in the 36-byte `0x11` commitment) deliberately
has **no published preimage**: the protocol binds the context bytes to the
Receipt but assigns no meaning to them, and the recognizer never decodes them.
`protocol/constants.json` records only the byte-length fact of its prefix —
`REPID-RCTX-V1` is 13 ASCII bytes, corrected from an earlier 12-byte claim — and
the conformance KAT pins that count.

### 7.3 Who declared a platform confirmation or a trust link?

Neither payload names its declarer, because the **signature that spent the
value is the authority**. The recognizer reads the first input's unlocking
script, locates the 33-byte compressed public key at its tail, and hashes it.

The specification is candid that this is a **shape match, not a signature
check**: it reads a public key out of the script and hashes it; it does not
verify that the signature over the transaction is valid for that key. That is
correct behaviour for an indexer — the network already enforced the signature —
and the specification forbids reusing this derivation as an authentication
mechanism.

### 7.4 Recognizing the genesis facts structurally

**Identity genesis.** Output 0 must carry a token with capability `none` and
amount `0`. There must be either one output (legacy form) or two (vault form);
any other count is not a fact. In the vault form, the token's commitment must be
exactly 20 bytes and must equal the owner's public-key hash, the second output
must be a tokenless P2PKH change to that same owner, the collateral is the
value of output 0, and the identity is tracked at `txid:0`.

**Receipt genesis.** There must be three or four outputs. In the four-output
form, output 3 must be tokenless change. Outputs 0, 1 and 2 must each carry a
token with capability `none` and amount `0`, all three sharing one category. The
receipt in output 0 must have an **empty** commitment (the legacy form) or, in
`0.4.0`, a 4-byte (`0x10`) or 36-byte (`0x11`) **interaction context**
commitment (`RECEIPT_GENESIS` then carries `receiptContext`), and be locked to
party A; the Rating Rights in outputs 1 and 2 must have **non-empty**
commitments forming the **cross** pair. A fourth output carrying a token is not
change and is not recognized. The context commitment's format byte has a **fixed
high nibble `0x01`** and a low nibble whose only defined flag is bit 0
(`HAS_HASH`), so exactly `0x10` (4-byte form) and `0x11` (36-byte form) are
valid; any other byte, or any other commitment length (1–3, 5–35, 37+ bytes) is
**not a fact** (SPEC-009 RF-W73). The roles are not free text either: `roleA` is
the role of the party that locks output 0 (`receiptOwnerPkh`) and `roleB` the
role of the other party from the cross pair, so the commitment always stays
within the two parties already present in the Receipt (SPEC-008 RF-O10) — and
unknown `category`/`role` bytes are still a valid fact with an application-level
meaning, never a rejection.

> Source: `spec/SPEC-009-repid-wire-format-and-recognition.md` §3–§6, §9;
> `protocol/constants.json`; `spec/SPEC-008-repid-protocol.md` §4.7.

---

## 8. How a fact is recognized

Recognition is what turns a pile of transaction bytes into structured facts. It
is defined as **deterministic and shape-based**, and it runs **without executing
the Bitcoin VM** and **without re-validating signatures** — the network already
did that, and redoing it would be wasted work.

The distinction the protocol draws is worth internalizing: **the indexer
*recognizes* a fact; the chain *verifies* it.** A fact is verifiable because the
transaction that produced it exists on chain and its transaction id anchors it.

### 8.1 The fixed order of attempts

More than one rule can match a single transaction, so the order is normative.
The first rule that produces a fact wins:

1. **Identity spend** → collateral top-up or burn
2. **Identity genesis** → identity created
3. **Receipt genesis** → receipt created
4. **Issued rating** → rating given (the tag disambiguates `REPID_RATING1` and `REPID_RATING2`)
5. **Platform confirmation** → corroborated
6. **Rating retraction** → rating retracted
7. **Trust link** → trust declared

The identity spend must be tried **before** the identity genesis, because adding
collateral re-issues the same token toward the same covenant and therefore has
the *same shape* as creating an identity. The only thing that tells them apart is
whether that outpoint was already being tracked.

The retraction in step 6 needs the rating of the referenced receipt to have been
seen, so it follows the rating recognizer; its tag is disjoint from every other
recognizer's, so nothing else can claim it.

### 8.2 The state an indexer must keep

The chain does not remember certain things, so an indexer has to. This state is
small but mandatory:

- **Live Rating Rights** — which outputs are outstanding, and who they entitle.
- **Indexed receipt transaction ids** — so a platform confirmation can be checked.
- **Tracked vault outputs** — so a top-up can be distinguished from a mint.
- **Issued ratings** — which rating each spent Rating Right produced, so a
  retraction can reference it (SPEC-008 RF-O12's "issued ratings" ledger).
- **Receipt interaction contexts** — so the `0.4.0` context of a
  `RECEIPT_GENESIS` stays available to later facts.
- **The retracted ratings set** — so a repeated retraction of the same rating is
  marked invalid deterministically.

On each fact, the indexer advances that state: it starts tracking a new
identity's vault output, **moves** tracking to the new output on a top-up,
**removes** it on a burn, starts tracking both Rating Rights and the receipt on a
receipt genesis, and **removes** a Rating Right when it is spent. The state must
be persisted, so recognition survives a process restart.

An indexer starting from nothing can still recognize an identity genesis and a
receipt genesis, but it **cannot** recognize a rating, a top-up or a burn, and it
**cannot** validate a platform confirmation — all of those reference something
recognized earlier.

### 8.3 Order of appearance matters

A platform confirmation is validated against receipts the indexer has already
seen. A confirmation that arrives before its receipt is recognized but reported
**invalid**. This is a stated restriction, not an oversight, and it is the price
of an indexer that does not run the VM and does not reorder history.

### 8.4 Three possible outcomes

This is the part most worth getting right, and the protocol separates the cases
explicitly:

| Outcome | When | What appears |
|---|---|---|
| **Valid fact** | The shape matches *and* the semantic rules hold | The fact, with no objection |
| **Invalid fact** | The container is well-formed but a semantic rule is broken | The fact, marked `valid: false` |
| **Non-fact** | The transaction matches no known shape at all | Nothing — no fact, no error |

A **malformed container** — wrong number of chunks, wrong payload length,
unreadable push — produces **no fact at all**. A **semantically invalid fact** —
a well-formed container that breaks a rule, like a score of 9 — is still a fact,
and is published with `valid: false`. It is never silently dropped, and the value
is never clamped: a 9 stays a 9, and the fact says it is not a valid rating.

The six cases where an invalid fact is published rather than hidden:

- A score outside 1–5.
- A collateral fact that does not preserve the token, or whose new collateral is
  lower than the recorded one. In that case the indexer also refuses to advance
  its tracking to the invalid state.
- A platform confirmation referencing a receipt it has not indexed.
- A platform confirmation whose confirming platform is a party to the receipt it
  corroborates (`0.4.0`).
- A rating retraction that references an unknown rating, that is not signed by
  the original rater, or that retracts an already-retracted rating (`0.4.0`).
- A Trust Link that declares trust in the declarer's own key.

> Source: `spec/SPEC-009-repid-wire-format-and-recognition.md` §5, §7, §8;
> `spec/SPEC-008-repid-protocol.md` §5, §5.1.

---

## 9. What the facts allow you to conclude

This section draws the boundary around interpretation, which is the part of
RepID that is deliberately *not* regulated.

**The protocol constrains your interpretation in exactly four ways:**

1. It must operate only on recognized facts, and it must never modify a fact or
   its validity.
2. It is never a conformity requirement. **Two implementations may compute
   different reputation from the same facts and both be conformant.** This is
   the direct consequence of the central idea.
3. It must distinguish valid facts from invalid ones, and must grant no value to
   the invalid ones.
4. If an implementation defines a confidence index, that index must be local,
   auditable down to the individual fact that produced it, and must not be
   presented as a protocol fact.

**What is therefore possible, without any extension to the protocol.** From the
eight facts as defined, an interpreter can compute the number of ratings an
identity has received; how many came from parties that themselves hold
identities; how many of those ratings were later retracted by their rater; how
much collateral an identity has committed and how long it has held it;
how many counterparties have declared trust in an identity and how many trust
declarations it has itself made; how many interactions were corroborated by a
platform; and which of those interactions involved a repeat counterparty. Each
of these is arithmetic over facts that already exist. The computation can also
break down **by interaction category** and **by role** — since `0.4.0` the
receipt carries both on-chain (`receiptContext`), so e.g. an interpreter can
separate the ratings received as a "rider" from those received as a "client",
or average only the interactions of one declared category (SPEC-008 RF-E11,
RF-V15).

**What is not possible, and would require changing the protocol rather than
writing a new application:** storing a reputation number on-chain, weighting
ratings inside a covenant, having one party rate another without a
mutually-signed receipt, cancelling a published fact, or forcing an indexer to
arrive at a particular reputation conclusion.

**Interoperability is a design goal, not a promise.** RepID's tag space is
readable and versioned so that a data output is attributable to RepID and to
nothing else. Different applications may build on the same facts without
coordinating in advance, because the schemas are published. An application that
needs its own extra events must define them outside this protocol and must not
alter the meaning of a RepID fact.

> Source: `spec/SPEC-008-repid-protocol.md` §6, §8.

---

## 10. Security, abuse resistance and the honest limits of each

RepID makes no claim to solve Sybil attacks, spam, collusion or reputation
farming. It is explicit about which of those it *constrains on-chain* and which
it *delegates to interpretation* — and about the fact that some of them it does
not solve at all.

| Abuse vector | What the protocol guarantees on-chain | What is left to interpretation | What remains unsolved |
|---|---|---|---|
| **Sybil** | Nothing beyond network fees and, optionally, identity collateral; since `0.4.0` an identity cannot be destroyed within 144 blocks of minting or of its last top-up, so at least that window exists to read it before its collateral can walk away | Weighing by identity or collateral | Any number of identities can still be created |
| **Spam** | Only the cost of fees | Filtering or deprioritizing by local criteria | There is no protocol rate limit |
| **Self-promotion** | A trust declaration about oneself is marked invalid | — | Two colluding parties can rate each other, which is not direct self-rating |
| **Collusion** | Ratings require a mutually-signed receipt and a single-use right | Detection and weighting | A real interaction cannot be distinguished on-chain from a simulated one |
| **Reputation farming** | One rating per right, enforced by single-spend | Weighting by counterparty, recency, collateral | Nothing prevents several interactions that are each worth farming |
| **Selective acceptance** | A non-existent receipt produces no facts | Flagging a pattern of one party always declining to sign | If a party simply refuses to sign, there is no on-chain recourse |
| **Rating manipulation** | The score range is fixed; out-of-range values are marked invalid | Judging the intent behind a rating | The protocol cannot verify that a score is truthful |
| **Retracting a rating** | A retraction is itself a fact: who retracted, which rating, and when, signed by the original rater | Weighing *why* a rating was retracted (pressure, payment, disagreement) | A false retraction is as unverifiable as a false rating |
| **Self-corroboration** | Since `0.4.0`, a platform confirming a receipt it is a party to is marked invalid | An interpreter may discount the platform confirmations of a platform that has a weak corroboration record | A second key under the same operator still evades the rule |

The rule that follows from this table is part of the protocol's conformity
requirements: **an implementation may not present an anti-sybil, anti-spam or
anti-collusion mitigation as a guarantee if it depends on the interpretation
layer.** And the limitations above must be documented rather than claimed as
solved.

> Source: `spec/SPEC-008-repid-protocol.md` §7, §7.1.

---

## 11. Versioning

A transaction, once broadcast, may be interpreted for years. Therefore **the
meaning of a historical event must never change** — that is the requirement
versioning exists to protect.

The protocol version is a three-part semantic version, `0.5.0`, recorded in
machine-readable form so that an implementation can check what it is speaking
to. An implementation must declare the set of protocol versions it supports and
must fail loudly rather than operate on a version it does not implement.

**What a version covers** — everything an independent implementation must agree
on in order to reach the same conclusion about a transaction: the data-output
tags and encoding, the field schema of all eight facts, the recognition and
validation rules, the on-chain invariants and covenant interfaces, and the score
range.

**What a version does not cover:** reputation models and confidence indices,
storage, transport and query interfaces, application workflows, wallet software
and key custody, and any user interface. These are allowed to differ between
implementations without affecting conformity.

**How the version of a fact's format is identified.** A fact's payload carries no
version string. The version lives in the **tag**: `REPID_RATING1`,
`REPID_RATING2`, `REPID_PLATFORM1`, `REPID_RETRACT1` and `REPID_TRUST1` all end
in a revision digit, and that digit is the version of the tag's encoding. A
recognizer that has matched a tag therefore already knows which rules govern the
payload behind it.

This matters for safety. A tag whose revision an implementation does not know
matches nothing, and under the recognition rules that yields **no fact at all** —
not a fact with unreadable fields. A wrong reading of a fact is therefore
unreachable rather than merely forbidden. A future change to a payload must
ship as a new tag with a new revision digit, which is a `MAJOR` change, and must
never reuse an existing tag.

**Which changes break compatibility:**

| Change | Version required |
|---|---|
| Adding, removing or renaming a fact type | `MAJOR` |
| Adding, removing or renaming a fact field, or changing its encoding | `MAJOR` |
| Changing a tag or the container layout | `MAJOR` |
| Changing the score range | `MAJOR` |
| Changing a covenant interface or an on-chain invariant | `MAJOR` |
| Changing the recognition order or its precedence rules | `MAJOR` |
| Adding an **optional** field that recognizers ignore when absent | `MINOR` |
| Adding a specification that does not alter existing facts | `MINOR` |
| Clarifying an edge case without changing a rule | `MINOR` |
| Typos, formatting, examples, cross-references | `PATCH` |

The governing invariant: **any change that could alter the reading of a
historical transaction is `MAJOR`, with no exception for "small" changes.**

**Migration.** Within one `MAJOR` version, no migration is ever required.
Across a `MAJOR` boundary, historical facts are **never rewritten** — they are
read under the rules that produced them. There is no on-chain migration, because
the chain is immutable by design. A new `MAJOR` must ship alongside the previous
one for at least one release cycle.

### Why the version stays below `1.0.0`

The leading zero is a promise, not modesty. `1.0.0` is reserved for a version
that has been validated by an implementation outside this project, and
`protocol/protocol-version.json` states the two objective criteria required:

1. At least one independent implementation outside this repository has been
   verified against the recognition rules and the wire format, following the
   external indexer guide.
2. The covenant artifacts have been executed by the Bitcoin VM on a public test
   network with **every** on-chain invariant asserted, not merely observed.

Neither criterion is met today. The protocol says so rather than rounding up.

> Source: `spec/SPEC-010-protocol-versioning.md` §2, §3, §4, §6, §7, §8;
> `protocol/protocol-version.json`.

---

## 12. Conformance: what "conformant" means and how it is checked

Conformance in RepID is split, because building the artifacts and reading them
are different problems:

- **Issuance conformity** — an implementation produces on-chain artifacts that
  satisfy the invariants.
- **Recognition conformity** — an implementation recognizes facts with the
  defined fields and applies the defined validity semantics.
- **Full conformity** — both.

Conformity must be demonstrated with **real executable evidence**, not with
descriptions. And an implementation may not declare itself conformant if it
introduces an on-chain value judgment, or if it presents a known limitation as a
guarantee. Differences in non-normative layers — interface, storage, network,
reputation model — must not change protocol results.

### The checks in this repository

| Command | What it proves |
|---|---|
| `npm test` | The fact schema and the protocol constants behave as specified, checked against facts reconstructed from a real network run, including negative cases |
| `npm run specs:check` | No specification has a dead reference and no specification is missing |
| `npm run requirements:check` | The machine-readable requirement inventory still matches the specifications that declare it |
| `npm run encoding:check` | No text file carries mojibake, and no file was partly rewritten with the wrong line endings |
| `npm run artifacts:check` | Each covenant source recompiles to exactly the committed artifact |

`npm test` runs the first four.

**Measured on 2026-10-08:**

| Check | Result |
|---|---|
| `npm test` | **60 tests, 60 passed, 0 failures**, running unconditionally |
| `npm run specs:check` | 9 specifications, 218 requirement declarations, no dead references |
| `npm run requirements:check` | 218 declarations extracted, inventory in sync |
| `npm run encoding:check` | 51 text files, valid UTF-8, no mojibake, no partly rewritten file |
| `npm run artifacts:check` | All contract artifacts reproduce exactly: four covenant sources, five compiled artifacts (identityVault 0.3.0 and 0.4.0 verified separately; the registry records the same vault body for 0.5.0, which changed no covenant), with `cashc` 0.13.2 |

`artifacts:check` is designed so that an absent toolchain can never masquerade
as a pass: it reports `SKIPPED`, never `PASS`, when the compiler cannot be
found. Its own trustworthiness is backed by a negative test confirming the check
fails on a modified contract.

One thing worth knowing about the artifact check: the fingerprint the compiler
emits is **not** a conformity anchor, because it does not change when a
contract's logic changes. The check therefore compares the complete artifact —
bytecode, interface, embedded source and debug bytecode — rather than the
fingerprint.

> Source: `spec/SPEC-008-repid-protocol.md` §9, Annex B.2;
> `constitution.md` Article 3; `README.md`; `protocol/constants.json`;
> `tools/check-artifacts.mjs`; `conformance/schema.test.mjs`.

---

## 13. The reference implementation, and what has actually been proven

The specification is the product; the code exists to demonstrate that it is
satisfiable. The implementation lives in three separate repositories, which is
itself part of the design — the protocol is not allowed to be entangled with any
one product.

| Repository | Role |
|---|---|
| `repid-protocol` | The specifications, the canonical covenant sources, and the conformance suite. No runtime code. |
| `repid-sdk` | Recognition: decodes raw transaction bytes into facts, and maintains index state. |
| demo | A working application: wallets, a console, and an example two-party interaction. |

**The covenants are normative and live in the protocol repository.** Their
CashScript sources are the canonical text, compiled with `cashc` 0.13.2:

- `contracts/identity_vault.cash` — `mint`, `increaseCollateral`, `burn`;
  versioned since `0.4.0` (`contracts/identity_vault_0_3_0.cash` frozen and
  `contracts/identity_vault.cash` adding the burn delay)
- `contracts/receipt_genesis.cash` — `mint`, requiring both parties' signatures
- `contracts/rating_right.cash` — the `RatingRightVault` that each Rating Right
  is locked into; its single spend path destroys the token (SPEC-008
  RF-O822/RF-O823)
- `contracts/identity_genesis.cash` — the legacy single-use form

Four covenant sources, five compiled artifacts (the identity vault's two
versions are verified separately, SPEC-008 RF-W56/RF-W76).

### Evidence of execution

**On a real network.** Facts were reconstructed by the reference
implementation from a real **Chipnet** run on 2026-09-27 and are stored in the
conformance suite as vectors. That run produced two identities, one receipt with
two Rating Rights, and both parties rating each other. Those real transaction
identifiers are the source of the fixture the schema is checked against — the
suite tests real bytes, not hand-written examples.

**Recognition coverage, measured 2026-10-08:** the recognition SDK's suite
reports **150 tests, 150 passed, 0 failures** across 15 files, all running
unconditionally with no network access. Within it, 23 tests cover data-output
container parsing and 16 cover the receipt-genesis shape (including the `0.4.0`
interaction-context commitment), the areas that had previously been specified
but unverified.

**The demonstration application, measured 2026-10-08:** 73 tests across 4 files;
35 pass unconditionally and 38 are skipped. The skipped tests mint a genesis and
therefore require funded wallets on a real test network; they are declared
unverified rather than counted as passing.

**Real-VM end-to-end runs** against the Bitcoin Cash test network are performed
by dedicated scripts in the demonstration repository, which exercise issuance
against the actual Virtual Machine rather than a simulator.

**What is proven per fact type — the honest matrix.** A fact can be covered by
three different kinds of evidence, and they are not interchangeable:

- **(a) real transaction with txid** — the transaction was actually broadcast to
  the Chipnet test network and its `txid` was recorded;
- **(b) local VM without broadcast** — the spend was executed by the real
  Virtual Machine locally (libauth, `BCH_2026_05`), but never transmitted;
- **(c) specified / recognition only** — the shape is specified and exercised by
  the recognizer's conformance vectors, without any VM execution.

For the count below, **"executed" is defined as level (a)**. The matrix shows the
highest level reached per fact type:

| Fact type | Evidence | Notes |
|---|---|---|
| Identity genesis | **(a)** | Real tx with txid: `real-chain-facts.json` (2026-09-27) + TASK-026 (2026-09-10, `ac8027090206…`) |
| Collateral top-up | (c) | Covenant compiled and recognized; no local VM test for `increaseCollateral`, no broadcast (TASK-037 real run has no network evidence) |
| Identity burn | (b) | Executed by the local VM in `identity-vault-burn-delay.test.mjs`; never broadcast |
| Receipt genesis | **(a)** | Real tx with txid: `real-chain-facts.json` (2026-09-27) + TASK-026 (2026-09-10, `c5d7a5cc872e…`) |
| Rating issued | **(a)** | Real tx with txid (Rating Right spend): `real-chain-facts.json` (2026-09-27) + TASK-026 (2026-09-10) |
| Rating retraction | (c) | Newest fact (`0.4.0`); no demo endpoint, no real broadcast produced |
| Platform confirmation | **(a)** | Real tx with txid from TASK-026 (2026-09-10, `50c65e7164135005…`) |
| Trust link | **(a)** | Real tx with txid from TASK-026 (2026-09-10, `5170e3a9cdcd…`) |

**Five of the eight fact types have therefore been executed by the real Virtual
Machine on Chipnet**: identity genesis, receipt genesis, rating issued, platform
confirmation and trust link, all with recorded `txid`s. The criterion is applied
with the same yardstick to every row — platform confirmation and trust link
qualify because their transactions were really broadcast (TASK-026, 2026-09-10),
and **rating retraction does not**: it is the exception. Retraction is the newest
fact (`0.4.0`), its spend is a plain P2PKH (no covenant to compile), it is fully
covered by the recognizer's tests, but the demonstration application does not
expose a retraction endpoint yet, so no real broadcast transaction exists for
it. Its on-chain rule is the same as the other P2PKH spends — a signature the
network enforces and a data output the indexer reads — but that equivalence has
not been turned into real-VM evidence.

**Identity burn** sits a level lower: executed by the VM locally but never
broadcast. **Collateral top-up** and **rating retraction** are specified and
recognition-tested only; in particular, no conformance test runs
`increaseCollateral` through the VM, so its on-chain invariant has the weakest
evidence in the table. Two of the five level-(a) rows — platform confirmation and
trust link — have recorded txids but their bytes are not retained as conformance
fixtures; the other three are retained in
`conformance/fixtures/real-chain-facts.json`, which records mechanically which
rows are fixtures today.

### What has not been proven

Stated plainly, because the project's own rules require it:

- Only **three of the eight** fact types — identity genesis, receipt genesis and
  rating issued — have real broadcast bytes **retained as conformance fixtures**
  in this repository. Five have real broadcast transactions with recorded txids
  (the matrix above); two of those five — platform confirmation and trust link —
  have no retained fixture bytes, and collateral top-up and rating retraction
  have no real-VM evidence at all. None of this is inferred: every row and every
  count comes from the matrix, which states where each claim lives.
- **The covenant interface has no automated regression coverage.** The
  mock-based unit tests that provided it were removed. What was lost was
  interface-shape regression coverage, not real-VM evidence, since the mock
  never executed the Virtual Machine. Covenant conformance therefore rests on
  real-VM runs rather than on a test suite.
- **Seven recognition vectors have no test yet**, listed in the wire-format
  specification's Annex B, including a well-formed rating payload with no tracked
  Rating Right, and a transaction that matches two rules at once.
- The demonstration application's **user interface is verified manually only.**
  No automated interface test is claimed.
- **No independent implementation has verified these rules.** This is the
  reason the version stays below `1.0.0`.

> Source: `REFERENCE-IMPLEMENTATION.md`; `spec/SPEC-009-repid-wire-format-and-recognition.md`
> §10.1, Annex B; `spec/SPEC-008-repid-protocol.md` Annex A, Annex B.2;
> `conformance/fixtures/real-chain-facts.json`; `protocol/protocol-version.json`.

---

## 14. Declared limitations

These are stated by the protocol itself. They are not a list of future work;
they are the boundaries of what RepID claims. None of them is a guarantee.

**About recognition**

- The recognizer **trusts the network's signature enforcement**. It reads a
  public key out of an unlocking script and hashes it; it does not verify the
  signature. Correct for an indexer, and explicitly forbidden as an
  authentication mechanism.
- Determinism is over **a single transaction and the current state**, not over a
  chain reorganization. Confirmations, block ordering and reorganization
  handling are out of scope.
- **State is required.** An indexer starting empty cannot recognize ratings,
  collateral top-ups or burns, and cannot validate platform confirmations.
- Recognition is **shape-based, and therefore spoofable by an issuer able to
  produce the bytes.** What makes a fact genuine is the covenant and the
  network's script execution; the indexer only reads what survived them.
- Order of appearance matters, so a platform confirmation seen before its
  receipt is reported invalid (and, since `0.4.0`, so is a rating retraction
  seen before the rating it retracts).
- `commentHash` and `contextHash` fidelity is not verifiable on-chain: the
  recognizer reports the hashes exactly as spent; the correspondence with an
  actual off-chain comment or context is an application claim. The two hashes
  differ in one real respect: the `commentHash` preimage is **normative and
  salted on purpose**, and it binds the utterance to its Receipt by hashing that
  Receipt's `receiptCategory` (so anyone who holds the off-chain comment and the
  salt can prove it was the one committed — without the hash being guessable
  from a short text, and without the same comment being reusable across two
  interactions), while the `interaction contextHash` deliberately has **no
  published preimage format** — the protocol binds context bytes to the receipt
  but assigns no meaning to them, and the recognizer never decodes them.

**About evidence and tooling**

- A transaction simulator used in earlier testing **does not execute the Virtual
  Machine and does not validate signatures.** A transaction it accepts is not
  proof that its script is correct. Consequently, the "impostor" cases — where
  a plain output pretends to be a covenant output — remain **inconclusive** with
  currently available tooling, and no coverage is claimed for them.
- The compiler-emitted artifact **fingerprint is not a conformity anchor**: it
  does not change when a contract's logic changes.
- The covenant interface has **no automated regression coverage**, as described
  above.
- Seven recognition vectors remain untested.

**About the protocol's reach**

- **Multi-party interactions are out of scope.** An interaction has exactly two
  parties, and so does a receipt.
- **There is no on-chain dispute mechanism.** A published fact stands. An
  identity can be burned, and since `0.4.0` a rater can **retract** its own
  rating — but the retraction is itself a published fact, not an erasure: the
  original rating keeps its place in history and the interpreter weighs the
  contradiction.
- **Ratings carry no free text.** Only the score — and, since `0.4.0`, a hash of
  an off-chain comment (`commentHash`) — is recorded. The comment text itself is
  never on-chain, and hash fidelity (a different comment with the same hash) is
  an application claim.
- **Key recovery and identity revocation without burning are out of scope.** An
  identity is immutable and has no on-chain recovery mechanism: a lost private
  key means an irremediably lost identity, together with the collateral locked
  behind it. The protocol accepts this risk deliberately and recommends that
  key custody be handled off-chain.
- The protocol cannot verify that a score is **truthful**, only that it is
  well-formed and in range.
- **Reputation, confidence indices, weighting, collusion detection, farming
  detection, Sybil and spam policies** are all outside the protocol, by
  definition. They belong to the application layer.
- Resolution of the link between a public-key hash and an identity is **not**
  part of the protocol.
- Storage, network choice and deployment are implementation decisions the
  protocol deliberately leaves unconstrained.

> Source: `spec/SPEC-009-repid-wire-format-and-recognition.md` §11, "Out of
> Scope"; `spec/SPEC-008-repid-protocol.md` §7.1, "Out of Scope";
> `REFERENCE-IMPLEMENTATION.md`.

---

## 15. Where to read next

The specifications are ordered. A reader looking for the short version starts
with the first three.

| Document | What it gives you |
|---|---|
| `constitution.md` | The ten non-negotiable principles. Short, and it outranks everything else. |
| `spec/SPEC-008-repid-protocol.md` | The protocol itself: principles, model, the eight events, on-chain rules, verification, interpretation limits, security, interoperability, conformance. |
| `spec/SPEC-009-repid-wire-format-and-recognition.md` | The byte-level contract and the recognition algorithm. |
| `spec/SPEC-005-indexer-protocol.md` | What a recognizer must conclude, and from what state. |
| `spec/SPEC-010-protocol-versioning.md` | The version identifier and what would change it. |
| `spec/SPEC-001` … `SPEC-006` | The per-feature rationale: identity, interaction, receipt, rating, indexer, trust. |
| `REFERENCE-IMPLEMENTATION.md` | Where each requirement is implemented and tested, with the honest limits of each kind of evidence. Non-normative. |
| `README.md` | The repository map and how to verify it. |

### Reproducing the checks in this repository

```bash
npm install
npm test                  # specs, requirement inventory, encoding, conformance suite
npm run specs:check       # no dead references, no missing specs
npm run requirements:check # the inventory still matches the specifications
npm run encoding:check    # no mojibake, no partly rewritten file
npm run artifacts:check   # every covenant recompiles to the committed artifact
```

### Source of the numerical claims in this document

Every figure quoted above was measured, not estimated. The protocol's own checks
(60 tests, 9 specifications, 218 requirement declarations, five reproducing
artifacts from four covenant sources) were run on 2026-10-08. The recognition
suite figure (150 tests in 15 files) and the demonstration application's figures
(35 passing, 38 skipped in 4 files) were measured on 2026-10-07 in their own
repositories. The real-network
provenance — Chipnet, five facts across three fact types, 2026-09-27 — is
recorded in `conformance/fixtures/real-chain-facts.json`.

---

## Appendix — Section-by-section traceability

Each section of this document is derived from the normative sources below. No
section introduces a rule, value or claim that is not traceable to one of them.

| Section | Normative source |
|---|---|
| 1. The one idea | `constitution.md` Art. 1; SPEC-008 §1; `README.md` |
| 2. The problem | SPEC-008 §1, §2, §4.6, §7; `constitution.md` Arts. 1–2 |
| 3. Guiding principles | `constitution.md` Arts. 1–10 |
| 4. Who is involved | SPEC-008 §2, §2.1, Annex B.1 |
| 5. The eight facts | SPEC-008 §3, §3.1, §3.2, §8.1; `protocol/schemas/repid-fact.schema.json`; `protocol/constants.json` |
| 6. On-chain components | `contracts/*.cash`; SPEC-008 §4.1–§4.5; SPEC-001; SPEC-003; SPEC-004 |
| 7. Wire format | SPEC-009 §3–§6, §9; SPEC-008 §4.7; `protocol/constants.json` |
| 8. Recognition | SPEC-009 §5, §7, §8; SPEC-008 §5, §5.1 |
| 9. What the facts allow | SPEC-008 §6, §8 |
| 10. Security and abuse | SPEC-008 §7, §7.1 |
| 11. Versioning | SPEC-010 §2, §3, §4, §6, §7, §8; `protocol/protocol-version.json` |
| 12. Conformance | SPEC-008 §9, Annex B.2; `constitution.md` Art. 3; `README.md`; `tools/check-artifacts.mjs`; `conformance/schema.test.mjs` |
| 13. Reference implementation | `REFERENCE-IMPLEMENTATION.md`; SPEC-009 §10.1, Annex B; SPEC-008 Annex A; `conformance/fixtures/real-chain-facts.json`; `protocol/protocol-version.json` |
| 14. Declared limitations | SPEC-009 §11 and "Out of Scope"; SPEC-008 §7.1 and "Out of Scope"; SPEC-001 "Edge Cases"; `REFERENCE-IMPLEMENTATION.md` |

**Precedence.** Where this summary and the specifications disagree, the
specifications win, in this order: `constitution.md`, then SPEC-008, then
SPEC-009, then the remaining specifications. This document is a description of
the protocol, not a source of rules.
