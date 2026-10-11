# SPEC-007: Reputation and Confidence Index (indexer interpretation)

## 1. Context and Objective

The **Confidence Index (CI)** is the 0–1 number that an indexer assigns to a **profile** to express how much confidence the signals it itself chose and weighted give it, *as on-chain evidence*. It is a datum **separate** from reputation.

**Reputation** is the star average (1–5) of the valid ratings the profile received. It is **a single, invariant number**: it does not change with the indexer's criterion, with anti-sybil or with any signal. No ratings yet → "no stars yet".

**The CI does not modify reputation nor the underlying fact:** it is a local interpretive value of the indexer, not a protocol fact. Two profiles with the same reputation can receive different CIs depending on the signals backing their numbers. The chain remains the source of truth; the Indexer (`server/reputation.mjs`, the prototype's **Indexer** page) only interprets it.

### Conceptual separation (do not confuse)

- **Rating:** what the participant expressed (fact `RATING_ISSUED`).
- **Interaction:** the event that occurred between participants (fact `RECEIPT_GENESIS`).
- **Validation:** evidence that an event or identity satisfies a verification criterion (fact `PLATFORM_CONFIRMATION`, the indexer's `valid`).
- **Reputation:** star average of the valid ratings received (invariant; `reputation`).
- **Confidence Index:** the confidence (0–1) that an indexer assigns to the **profile** according to the on-chain signals it chose to weight (`ci`).
- **Interpretation computation:** the indexer's answer for a profile: reputation + CI + auditable evidence.

### Important property

A low CI does not mean the reputation is false nor that the facts are invalid: it means a particular indexer found little evidence supporting it under its own criterion. A high CI indicates that the profile strongly satisfies the signals that indexer values. Low CI + high reputation also occurs (e.g. a single unverified top rating with minimal collateral): it is one more data point, not a correction of the stars.

## 2. User Stories

- As an indexer, I want to define my own confidence criterion by choosing which on-chain signals to weight and by how much, without altering reputation (stars) or facts.
- As a reputation consumer, I want to see two separate numbers for each profile — reputation (always the same) and CI (according to this indexer's criterion) — and to audit each contribution down to its transaction.
- As a protocol observer, I want the CI to never rewrite nor invalidate an on-chain fact, so that the chain remains the source of truth.

## 3. Functional Requirements (EARS Syntax)

The criterion **is not chosen as a predefined formula** (the `mode=simple|confirmed|baseline` format was replaced; so was the previous `useVerification/ciUnverified/…` model). The criterion is built by combining **signals** and their **weights** (`signals[key]` with `enabled` and `weight` 0–1) plus an `antiSybil` toggle.

**Signals available today** (data the indexer already reads from the chain — a decision of the demo indexer in `server/reputation.mjs`):

| Signal | On-chain data | Formula |
|---|---|---|
| `collateral` | sats of the identity vault (genesis/top-up) | `min(sats / 1000, 1)` |
| `tenure` | days since genesis (the identity fact's `at`) | `min(days / 90, 1)` |
| `confirmed` | ratings on Receipts with a valid `PLATFORM_CONFIRMATION` | `min(n / 3, 1)` |
| `endorsements` | valid `TRUST_LINK`s received | `min(n / 2, 1)` |
| `ratings` | valid ratings received in total | `min(n / 5, 1)` |

**CI = `round2( Σ(signal · weight) / Σ(weight) )`** over the signals with `enabled && weight > 0`. With no weighted signals → `ci = null`, `ciModel.applied = false`.

- **RF-01** (Ubiquity): The system must represent reputation and the Confidence Index as indexer interpretation, separate from the facts: neither reputation nor the CI may modify the underlying fact nor the validity the indexer recognizes (test: "no muta los hechos indexados").
- **RF-02** (Events): The system must compute reputation as the star average (1–5) of the valid ratings received, **invariant**: the same set of facts produces the same reputation under any criterion (test: "el promedio de estrellas no cambia aunque el criterio sí"); without valid ratings the result must be "no stars yet" (`reputation: null`).
- **RF-03** (Events): For each active signal with weight > 0, the system must compute its value as `min(count / threshold, 1)` over the profile's on-chain data (collateral sats, days since genesis, confirmed ratings, endorsements received and total ratings) (tests: "collateral…", "tenure…", "confirmed…", "endorsements…", "ratings…").
- **RF-04** (Events): The system must compute the CI as the weighted average of the active signals; a signal with weight 0 or disabled must not participate (value and contribution 0); without weighted signals the CI must remain undefined (`null`, `applied: false`) and reputation must remain intact (tests: "CI = Σ(señal × peso) / Σ(peso)", "señal con peso 0 o desactivada…", "sin señales con peso…").
- **RF-05** (Events): When the `antiSybil` toggle is active, the system must discard, from the **CI evidence**, the ratings from Identity-less wallets (the `confirmed`/`ratings` signals count only their Identity-bearing contributors), but must **not** change the star average (tests: "ratings sin Identidad salen de la evidencia CI pero sus estrellas quedan").
- **RF-06** (Undesired Behavior): If a fact is `valid: false` (self-trust, confirmations of unknown Receipts, out-of-range scores), the system must not give it stars nor CI evidence (test: "los hechos inválidos no agregan estrellas ni evidencia").
- **RF-07** (Events): The interpretation result must expose the indexer's CI model (`ciModel`: `applied`, `antiSybil`, signals with `threshold`, `count`, `value` and `contribution`), the raw counts and every contribution as **evidence** with a `txid` (ratings with their Receipt and confirmation, trust votes and identity genesis with collateral) for auditability; configurations of the previous schema (`useVerification`/`ciUnverified`/…) must be recomposed to the defaults (tests: "exposes…", "configs of the previous schema are recomposed to the defaults").
- **RF-08** (Events): The indexer must be able to save **named** criterion configs on the server (they persist in `repid-state.json` on Chipnet), list them, apply them and delete them; the **«Sample»** preset is built-in, read-only and non-deletable; the name must be non-empty, different from «Sample» and up to 24 characters (E2E tests: "lista la preset «Sample»…", "rechaza guardar como «Sample»…" and "una configuración guardada se puede aplicar…").

## 4. Non-Functional Requirements

- Determinism: same facts + same criterion (signals, weights and anti-sybil) → same result.
- No persistence of the interpretation: the criterion lives in the demo session (Indexer page); the named configs are the demo's off-chain tooling; the result of an interpretation is not persisted.
- Auditability: each contribution with its signal/CI carries the `txid` of the fact that originated it.

## 5. Edge Cases and Constraints

**The CI is indexer-defined**: the signal thresholds (1000 sats, 90 days, 3 confirmed, 2 endorsements, 5 ratings) and the default weights are the demo indexer's choice, not protocol values. Another indexer can use other values, other signals and other weights (per the concept: "Different indexers may establish different criteria and values according to their own purposes").

**Identity age and identity fact**: the indexer internal Map (`identitiesByPkh`) keeps `collateral` and `ownerPkh` but not always `at` (the timestamp is only added to the copy in `facts`); the tenure signal resolves `at` from the corresponding `IDENTITY_GENESIS` fact (fallback documented in the code). Vault recognition (genesis, top-up and burn) stays as is: collateral travels as a string and the signal only reads it.

**The CI calls for more verification, not more facts**: today the prototype models verified evidence via `PLATFORM_CONFIRMATION`. Other verification sources (external to RepID, aggregated by the app) are a richer indexer model, in the same layer — out of scope of this spec.

**Anti-sybil is not a signal**: discarding ratings from Identity-less wallets from the CI is a hard criterion decision (toggle), different from how much each signal weighs. Their stars are **never** touched.

## 6. Out of Scope

- Modifying the indexer's fact recognition or the protocol layer (the CI acts only on interpretation).
- Deriving the identity or the "pkh → Identity link" (off-chain, later layer; SPEC-005 §6).
- Trust graph, propagation, recency and the rest of the full reputation algorithms (SPEC-005 §6).

## 7. Acceptance Criteria (Definition of Done)

- [x] `server/reputation.mjs` models invariant reputation (star average) and a separate CI based on signals (`collateral`, `tenure`, `confirmed`, `endorsements`, `ratings`) with `enabled` + `weight`, and the `antiSybil` toggle; **no `mode` formulas** nor the `useVerification/…` schema (`normalizeParams` discards unknown keys and recomposes old configs).
- [x] The CI formula is in a real test with mixed values ("CI = Σ(señal × peso) / Σ(peso)", `test/reputation.test.js`) and reputation invariance in the test "el promedio de estrellas no cambia aunque el criterio sí".
- [x] Non-mutation test: interpreting does not alter the indexed facts ("no muta los hechos indexados").
- [x] RF-02 to RF-07 backed by real tests (`test/reputation.test.js` = 20 tests + server E2E).
- [x] RF-08 backed by real server E2E tests (`test/e2e_server.test.js`).
- [x] Full suite green: `npx vitest run` → 128 tests, 0 failures.
- [x] Documentation synchronized (SPEC-005 §6, `AGENTS.md`, `README.md`, `docs/TESTING.md`).