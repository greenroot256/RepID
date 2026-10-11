# Constitution Compliance Audit

Audit of `constitution.md` (10 articles) against the code in this repository, in `repid-sdk`, and in the reference implementation `repid-demo`.

- **Date:** 2026-10-01
- **Scope:** the three canonical repositories `greenroot256/repid-protocol`, `greenroot256/repid-sdk`, `greenroot256/repid-demo`
- **Method:** every claim below is a file:line citation or a command whose output is quoted. Where compliance could not be determined from the repository, the article is reported as **not auditable** rather than assumed.

**Result: the code does not fully comply with `constitution.md` as written.** Three articles deviate and one spec is under-specified. The deviations are recorded here rather than resolved, because Article 6 reserves scope decisions for the architect.

| Article | Subject | Result |
|---|---|---|
| 1 | Central Architectural Principle | **Complies** |
| 2 | Simplicity over Complexity | **Complies**, with one specification gap |
| 3 | Tests Before Code | **Deviates** — traceability |
| 4 | Radical Honesty | **Complies** |
| 5 | Language | **Deviates** — one document |
| 6 | Out of Scope is Law | **Complies at the protocol boundary**; unreferenced additions in the demo |
| 7 | Mandatory Traceability | **Deviates** — no tracker in the normative repositories |
| 8 | Governance for a Non-Programmer Architect | **Not auditable from the repository** |
| 9 | Mandatory Plan Mode | **Not auditable from the repository** |
| 10 | Level of Commitment to the Specification | **No drift detected**, but the path is unexercised |

---

## Article 1 — Central Architectural Principle

> No on-chain value judgment (composite scoring, weightings, value judgments) in covenants.

**Complies.** All 60 `require()` statements across the three covenants were enumerated and classified. None encodes a score, a threshold, a weight, a ranking, or any rule about worth.

| Covenant | `require()` count | Value judgments |
|---|---|---|
| `contracts/identity_vault.cash` | 32 | 0 |
| `contracts/receipt_genesis.cash` | 20 | 0 |
| `contracts/identity_genesis.cash` | 8 | 0 |

Two numeric comparisons exist and were examined individually, because a threshold is the most plausible place for a judgment to hide:

- `identity_vault.cash:47` — `require(collateral > 0)` — a minimum amount, required by SPEC-008 §4.2 RF-O03.
- `identity_vault.cash:83` — `require(tx.outputs[0].value >= oldCollateral)` — collateral may not decrease, required by RF-O05.

Both constrain money, not merit. Neither compares a wallet against a policy number.

No covenant stores state in a covenant variable. `identity_vault.cash:29-34` states the intent explicitly: the collateral is inferred from the output value rather than remembered. Interpretation of the facts is off-chain, in the demo's `server/reputation.mjs`.

## Article 2 — Simplicity over Complexity

> No speculative logic: any logic in the code must be traceable to a requirement in a specification.

**Complies, with one specification gap.** Of the 60 `require()` statements, 56 map to a numbered requirement clause. Four do not:

| Location | Statement | Status |
|---|---|---|
| `identity_vault.cash:59` | `require(tx.outputs.length == 2)` (mint) | no numbered clause |
| `identity_vault.cash:87` | `require(tx.outputs.length == 2)` (increaseCollateral) | no numbered clause |
| `identity_vault.cash:100` | `require(tx.outputs.length == 2)` (burn) | no numbered clause |
| `identity_genesis.cash:42` | `require(tx.outputs.length == 2)` (mint) | no numbered clause |

This is a gap in the specification, not speculative logic in the code. SPEC-008 §4 describes what each output must contain — category, amount, commitment, locking bytecode — but never states the *number* of outputs as a numbered invariant, although the code enforces it. The code is stricter than the written requirement. A third party reading only the specification could produce a transaction the covenants would reject, and would have no way to learn that from the specification.

**Open assumption in normative source.** `receipt_genesis.cash:31-36` carries a comment marked as unresolved:

> DESIGN NOTE (assumed, to be confirmed): this version fixes the number of participants at 2 and therefore the number of outputs at 4, instead of generalizing with a loop over N participants.

An assumption awaiting confirmation sits inside a normative artifact. It is consistent with the specs, which declare multi-party out of scope — but it is recorded as provisional and no confirmed requirement closes it.

## Article 3 — Tests Before Code

> Every RF must have a real automated test before it is considered complete.

**Deviates.** The deviation is in traceability, not in the absence of tests.

The specifications declare **157 requirements** under **128 distinct RF identifiers**. The two numbers differ because nine identifiers are declared in more than one legacy spec — `RF-04` in SPEC-004 and SPEC-005, and others like it — so only the spec-qualified key `SPEC-NNN/RF-Xnn` identifies a requirement unambiguously. Counting identifiers rather than declarations understates the work, and the earlier revision of this audit did exactly that; the count below is per declaration, per spec.

Before the inventory existed, the test suites cited identifiers as follows:

| Location | Distinct RF identifiers cited |
|---|---|
| `repid-sdk/test/` (93 tests, 11 files) | 9 |
| `repid-protocol/conformance/` (23 tests) | 1 |
| `repid-demo/test/` (35 tests, 4 files) | 3 |
| Sum | 13 |
| **Union, counting `RF-04` and `RF-06` once** | **11 of 128** |

The 11 are `RF-03`, `RF-04`, `RF-06`, `RF-W01`, `RF-W02`, `RF-W05`, `RF-W08`, `RF-W38`, `RF-W39`, `RF-W40`, `RF-W45`. The union is reported in identifiers because the collisions make a per-declaration union meaningless: `RF-04` in SPEC-004 and `RF-04` in SPEC-005 are different requirements that happen to share a name, and a test covering one does not cover the other.

Citations are also coarse: `op_return_encoding.test.ts` covers `RF-W01`–`RF-W05` with a file-level comment, and `issued_rating_and_indexer.test.ts` names `RF-04` inside a single `it()`.

**117 of the 128 identifiers were cited by no test in any repository.** An unannotated requirement is not necessarily an untested one — a test may cover the behaviour without naming it, and 48 identifiers are cited in prose across `REFERENCE-IMPLEMENTATION.md` and the SDK sources, so some coverage is certainly real. But the link from requirement to test could not be demonstrated, and that is what Article 3 asks to be demonstrable. The claim "every RF has a test" was unverifiable rather than verified.

**Now enforced rather than asserted.** `tools/build-requirements.mjs` extracts the 157 declarations from the specifications into `protocol/requirements.json`, the SDK syncs that inventory, and `test/traceability.test.ts` fails when a mapping is missing a requirement, cites a test that does not exist, or falls below a declared per-spec floor. Every requirement is therefore accounted for as either covered by a named test or explicitly uncovered with a stated reason. Coverage, reported by the suite rather than asserted here:

| Spec | Declarations | Cited | Share |
|---|---|---|---|
| `SPEC-001` – `SPEC-006` | 42 | 0 | 0% |
| `SPEC-008` | 70 | 17 | 24% |
| `SPEC-009` | 45 | 9 | 20% |
| **Total** | **157** | **26** | **17%** |

The 26 are up from 11 because the mapping is written in terms of test names, which lets several requirements share a test that previously named only one of them. The legacy specs remain at 0 and are recorded as unverified rather than exempted: SPEC-001–006 are superseded by SPEC-008, and a spec that is not implemented is not thereby traced.

Requirements known to be genuinely untested, from the conformance suite's own records: the 7 recognition vectors of SPEC-009 Annex B.2 that the suite reports as open.

## Article 4 — Radical Honesty

> No unverified claims. Tooling limitations must be stated, not hidden. An unverifiable claim is removed.

**Complies, and the mechanism is demonstrably working.** Five false claims were found and corrected in the audit preceding this document; in each case the error had been published and believed:

| False claim | Correction |
|---|---|
| SPEC-010 §5 stated as normative that the SDK exports `SDK_VERSION` and `SUPPORTED_PROTOCOL_VERSIONS` | Neither symbol existed. The section now states the requirement without asserting facts about a specific codebase, and the SDK implements it (`repid-sdk/src/version.ts`). |
| SPEC-010 §6 stated that the wire format carried a `version` field | The field does not exist. The section now describes the real mechanism (revision digit in the tag). |
| `REFERENCE-IMPLEMENTATION.md` reported 42 recognition tests in 8 files | Measured 80 in 9 files at the time of the audit; 86 in 10 after §5 was implemented; 93 in 11 once requirement traceability was enforced. |
| `README.md` presented two spec sections as specified but unverified while citing 38 tests that do cover them | Corrected against the measured suite. |
| `constitution.md` carried U+00E2 U+20AC U+201D in all 14 of its dash characters | The file rendered, parsed and passed every check while damaged. Repaired, and `tools/check-encoding.mjs` now fails the build on mojibake and on a file that was partly rewritten with the wrong line endings. |
| `protocol/protocol-version.json` referenced `SPEC-005-fact-recognition.md`, which does not exist | Corrected to `SPEC-005-indexer-protocol.md`. |

Declared tooling limitations are present and specific rather than omitted: the `debug()` unlocker cases remain marked inconclusive, and the fact-type network evidence covers 3 of 7 event types with the shortfall stated.

## Article 5 — Language

> Code, contract names, technical identifiers in English. Documentation, specs, RFCs in English.

**Deviates — one document.** The protocol repository and the SDK contain no Spanish: a scan of every `.md`, `.ts`, `.cash`, `.json` and `.mjs` file returns 0 matches.

`repid-demo/references/repid-guia-visual.html` is written entirely in Spanish — the visual-identity reference cited by the demo's design conventions. It is documentation, and it is not English.

The rest of the demo is English. Its only Spanish match was a JavaScript variable named `el`, which is not prose and not a deviation.

## Article 6 — Out of Scope is Law

> Functionality marked Out of Scope in a current specification is not implemented. No functionality is added that is not in a specification.

**Complies at the protocol boundary.** A consolidated list of every out-of-scope declaration was collected from SPEC-001 through SPEC-010 and each item searched across all three repositories. No out-of-scope item is implemented in this repository or in the SDK: no multi-party logic, no revocation without burn, no disputes, no free-text ratings, no commit-reveal, no VM execution in the recognizer, no `pkh`–Identity resolution inside the recognizer.

The demo does compute weighted reputation (`server/reputation.mjs:190-213`, `:254-266`). This is not a violation: SPEC-005 §9, SPEC-008 §7 and SPEC-009 all explicitly assign interpretation to an application layer outside the protocol, and the demo holds its own SPEC-007 for it. The separation is the design working as intended.

**Unreferenced additions.** The finding under this article is the converse. The demo exposes routes and UI panels that no specification covers, and the protocol specifies no HTTP surface at all:

- `server/index.js` — wallet import, primary selection, naming, `transfer`, `sweep`, `tx/:txid/raw`, `tx/:txid/status`, `demo/run`, `reset`, `interpret-configs` CRUD
- `server/public/` — the Wallets tab in full, the "Validated by" validator filter in the Identities panel, the raw-transaction inspector

These are demo conveniences. They are the kind of functionality Article 6 names — added functionality that is in no specification — and they are undocumented as such.

## Article 7 — Mandatory Traceability

> Each unit of work must reference the RF it satisfies and be recorded in the task tracker of the repository that owns the change.

**Deviates.**

| Repository | Task tracker |
|---|---|
| `repid-demo` | `tasks.md`, 390 lines |
| `repid-protocol` | none |
| `repid-sdk` | none |

The two repositories that hold the normative artifacts — the covenants and the specifications — have no task tracker, so Article 7's recording requirement cannot be met for the normative layer. `repid-demo/tasks.md` demonstrates that the practice works when it is applied.

RF-level traceability fails for the same reason as Article 3, and the tracker gap is unchanged: 26 of the 157 declarations are cited in tests, and the two repositories with the strictest traceability duty still hold no task tracker of their own. The SDK now enforces the requirement-to-test half of this in code, but nothing tracks the other half, which is whether a requirement is finished.

## Article 8 — Governance for a Non-Programmer Architect

> The architect validates through specification review, real test results and functional demonstrations. The collaborator carries an enhanced responsibility not to mislead.

**Not auditable from the repository.** Three of the four requirements describe a working relationship, not a property of the code. They can only be judged by the architect.

The fourth — not misleading the architect — is evidenced under Article 4.

## Article 9 — Mandatory Plan Mode

> No modification to a covenant or to the indexer logic may occur without prior approval of the strategy in Plan Mode.

**Not auditable from the repository.** The rule governs process, and a repository cannot attest to how a change was agreed. The history offers no case to examine: the only commit that has ever modified a covenant is the import of the specification itself.

| Layer | Last modified |
|---|---|
| `contracts/identity_vault.cash` | `6e25f09` (import) |
| `spec/SPEC-001-identity-protocol.md` | `6e25f09` (import) |
| `constitution.md` | `6e25f09` (import) |

## Article 10 — Level of Commitment to the Specification

> Specification and code are kept synchronized in both directions.

**No drift detected. The path is also unexercised, and one direction has already failed.**

No drift: since the import commit `6e25f09`, no covenant has been modified, so no covenant can have diverged from its specification. The four later specification commits were corrections of fact about the wire format and the SDK, which correctly had no code counterpart — the documents were wrong, not the code.

One direction has failed. In the specification-to-code direction, SPEC-010 §5 asserted that the SDK exported an API it did not export, and that error survived review and was published. The reverse direction — the SDK reading a changed protocol version — is now enforced mechanically: `check:drift:strict` fails the build when `sync-protocol` has brought in a version the SDK has not been reviewed against, and the SDK's supported-version set is hand-written so that a check derived from the file it validates cannot pass by construction.

The unexercised path is the one Article 10 most depends on: a covenant change accompanied by a specification change. It has never happened, so the practice is untested.

---

## Summary of deviations

| # | Article | Deviation | Severity |
|---|---|---|---|
| 1 | 3 | 131 of 157 requirement declarations have no test cited for them | Medium |
| 2 | 5 | `repid-demo/references/repid-guia-visual.html` is in Spanish | Low |
| 3 | 7 | No task tracker in `repid-protocol` or `repid-sdk` | Medium |
| 4 | 2 | Four output-count invariants enforced in code but not stated as numbered requirements | Low |
| 5 | 2 | `receipt_genesis.cash:31-36` carries an unconfirmed assumption in normative source | Low |
| 6 | 6 | Demo routes and UI panels exist with no specification covering them | Low |
| 7 | 8, 9 | Not auditable from the repository | — |

Deviations 4 and 5 are recorded as specification gaps rather than code defects, because in both cases the code is defensible and the written requirement is what is incomplete.

**The acceptance criterion in SPEC-008 — "the code complies with `constitution.md`" — is not satisfied by this audit and is left unticked.** Deviations 1, 2 and 3 are real, and ticking the box would be the kind of unverified claim Article 4 forbids.
