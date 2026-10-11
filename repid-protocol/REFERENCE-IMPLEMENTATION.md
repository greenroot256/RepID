# Reference Implementation Map (non-normative)

> **This document creates no conformity obligation.** It records where each
> requirement is implemented and tested, so that a reader can verify the claims
> instead of taking them on trust. A conformant implementation may differ
> everywhere it is described here.

## 1. What is normative and what is not

| Artefact | Location | Status |
|---|---|---|
| Specifications | `spec/` in **this** repository | **normative** |
| Covenant sources | `contracts/*.cash` in **this** repository | **normative** — the canonical text of the covenants |
| Compiled artifacts | `artifacts/*.json` in **this** repository | **normative** — verified by `tools/check-artifacts.mjs` |
| Constants and schemas | `protocol/` in **this** repository | **normative** |
| Conformance suite | `conformance/` in **this** repository | **normative** — the shared definition of "conformant" |
| Recognition SDK | `repid-sdk` (separate repository) | reference implementation, non-normative |
| Demo / interoperability app | demo repository (separate repository) | reference implementation, non-normative |

Paths given below as `sdk:` or `demo:` belong to the **external** reference
implementation repositories and are deliberately not clickable from here. They
are recorded because the mapping is the evidence, not because this repository
depends on them. `sdk:` is the `repid-sdk` repository; `demo:` is the
interoperability demo. Recognition was split out of the demo into its own
repository, so its tests are TypeScript and live under `sdk:`, not under
`demo:`.

## 2. Requirement → implementation → test

Legend: **local** = this repository; **sdk** = the SDK repository;
**demo** = the demo repository.

| Requirement | Implementation | Evidence |
|---|---|---|
| RF-O03–RF-O07 (vault invariants) | `contracts/identity_vault.cash` (local) | **Real VM**, external: `demo:scripts/chipnet-vault-e2e.mjs` — mint with locked collateral, top-up requiring `value >= oldCollateral`, burn returning the collateral without re-issuing the category, re-mint. Plus source inspection. The 17 mock-based unit tests that covered the ABI were removed, so there is **no automated regression coverage of the covenant ABI**. |
| RF-O01–RF-O02, RF-E01, RF-M03, RF-V07 | `contracts/identity_vault.cash`, `sdk` | `sdk:test/identity_vault_indexer.test.ts` (5), the real Chipnet vault E2E, and inspection. The mock-based `test/identity_vault.test.js` (17) and `test/identity_genesis.test.js` (8) were removed. |
| RF-O08–RF-O11, RF-E04, RF-M02 | `contracts/receipt_genesis.cash`, `sdk` | **Real VM**, external: `demo:scripts/chipnet-e2e.mjs` (11/11 PASS) — joint-signature genesis producing two Rating Rights. Plus source inspection. The 10 mock-based unit tests in `test/receipt_genesis.test.js` were removed, so there is **no automated regression coverage of the covenant ABI**. |
| RF-O12–RF-O14, RF-E05, RF-S01, RF-S03 | `sdk` | `sdk:test/issued_rating_and_indexer.test.ts` (11) |
| RF-O15, RF-E06, RF-V08 | `sdk` | `sdk:test/platform_confirmation.test.ts` (4) |
| RF-O16–RF-O17, RF-E07, RF-S02 | `sdk` | `sdk:test/trust_link.test.ts` (3) |
| RF-E02, RF-E03, RF-V05, RF-V06, RF-V09 | `sdk` | `sdk:test/identity_vault_indexer.test.ts` (5) |
| RF-M01, RF-I03 | `demo:interaction` (off-chain) | `demo:test/interaction.test.js` (9) |
| RF-R01–RF-R04 (reputation, **not core**) | `demo:server/reputation.mjs` | `demo:test/reputation.test.js` (20) |
| RF-V03, RF-V04, RF-V10, RF-V11, RF-C03 | `sdk`, `demo:server` | `demo:test/e2e_server.test.js` — 3 run unconditionally; the 38 blocks that mint a genesis are **tBCH-gated** and run only with `REPID_E2E_FUNDS=1`, because the reference demo is Chipnet-only and boots on a temporary, unfunded data directory. |
| Field schema of the seven events (SPEC-008 §3) | `protocol/schemas/repid-fact.schema.json` (local) | `conformance/schema.test.mjs` (local) and `sdk:test/schema_conformance.test.ts` (9), including the five facts reconstructed from a real Chipnet run |
| Wire format and recognition (SPEC-009) | `protocol/constants.json` (local), `sdk:src/bytes.ts`, `sdk:src/recognize.ts` | `conformance/schema.test.mjs` (local), `sdk:test/protocol_inputs.test.ts` (5), `sdk:test/op_return_encoding.test.ts` (23, RF-W01–RF-W05 and RF-W45) and `sdk:test/receipt_genesis_shape.test.ts` (15, RF-W38–RF-W40). The open vectors are listed in SPEC-009 Annex B.2 |
| Rating Right is single-use, spent even when invalid (RF-W21) | `sdk` | `sdk:test/rating_right_consumption.test.ts` (5) — the five cases that regressed this behaviour |
| Declared set of implemented protocol versions (SPEC-010 §5) | `sdk:src/version.ts` | `sdk:test/sdk_version.test.ts` (6) — the declaration is hand-written rather than derived from the version file, so the test proves an unreviewed version is refused. The load-time refusal is exercised by the suite importing the SDK; the refusal itself is verified by two negative runs in which claiming `0.2.0`, or desynchronising `SDK_VERSION` from `package.json`, was shown to fail the suite |
| Tag revision identifies the format version (SPEC-010 §6) | `protocol/constants.json` (local), `sdk:src/bytes.ts` | `sdk:test/op_return_encoding.test.ts` (23) and `sdk:test/protocol_inputs.test.ts` (5) — the tag is compared by exact byte equality, so an unknown revision matches no recognizer |
| Covenant artifacts reproduce | `contracts/` + `artifacts/` (local) | `tools/check-artifacts.mjs` (local), which recompiles and compares the full artifact |

## 3. Honest coverage

Stated plainly, because a coverage claim that overstates itself is worse than
none:

- **The boundary and negative requirements** — absence of any on-chain score,
  absence of a central authority, the §7 interpretation limits — are verified by
  inspection and by the absence of violating code, **not** by automated test.
- **`MockNetworkProvider` does not validate raw transactions, but the builder does
  run the VM for contract inputs.** Two different things were previously
  conflated here, and the distinction matters for what a test proves.
  `provider.sendRawTransaction()` takes bytes and returns a txid: it does not
  execute the Bitcoin VM and does not check signatures or scripts, so a
  successful call is not evidence that a covenant is correct. But
  `TransactionBuilder.send()` with a contract input runs that contract's
  `require` statements in a debug VM and throws `Require statement failed` when
  one does not hold. This was measured while adding the SPEC-009 §9.2 tests: a
  three-output Receipt is refused by `receipt_genesis` at
  `require(tx.outputs.length == 4)` before the recognizer is reached.
  - Consequence for negative tests: a malformed transaction that a covenant
    already forbids **cannot** be built through the builder, so a test that tries
    to build one proves nothing. `sdk:test/receipt_genesis_shape.test.ts`
    therefore mints one canonical Receipt and perturbs the decoded outputs.
  - Consequence for evidence: a covenant's `require` statements *are* exercised
    by every builder-driven test. What those tests do not establish is the
    behaviour of the Bitcoin VM outside the builder, or the fact that the
    transaction is valid under consensus rules.
- **P2PKH "impostor" cases are inconclusive.** `debug()` rejects transactions
  using a custom `Unlocker` before evaluating them, so no coverage is claimed.
- **The contract `fingerprint` is not a conformance anchor.** It does not change
  when a contract's logic changes (measured; see SPEC-005 §6). Conformance is
  established by recompiling and comparing the full artifact.
- **The strongest issuance evidence is real-VM E2E**, external to this
  repository: `demo:scripts/chipnet-e2e.mjs` and `demo:scripts/chipnet-vault-e2e.mjs`.
- **UI coverage is manual.** No automated UI test is claimed; the reference
  demo is exercised by hand via its own testing guide.

## 4. External suite status

Measured separately, because recognition now lives in its own repository and a
single combined number would hide which half of the evidence is where. The
recognition figure was re-measured on **2026-10-08** by running `npm test` in
`repid-sdk`, and the demo figure on the same date by running `npm test` in the
demo repository with the funds gate unset.

| Suite | Repository | Result | Breakdown |
|---|---|---|---|
| Recognition | `repid-sdk` | **150 passed / 0 failed** (15 files) | all run unconditionally; no network needed; 7 of them enforce requirement traceability |
| Demo | demo repository | **35 passed / 0 failed, 38 skipped** (4 files) | `e2e_server.test.js` (3 unconditional of 41), `interaction.test.js` (9), `reputation.test.js` (20), `persistence_conformance.test.js` (3) |

The 38 skipped tests mint a genesis and have **not** been re-run against funded
wallets since the gate was added; they are declared unverified rather than
passing. Setting `REPID_E2E_FUNDS=1` enables them but does not fund anything: a
reachable, funded wallet is still required.

The 38 recognition tests that previously ran in the demo were **removed**, not
renamed, and replaced by 80 TypeScript tests in the SDK that assert the same
behaviour plus the cases the JavaScript suite never had. Keeping a copy of a
suite in a repository that no longer contains the code it tests would have
produced a number that looked like coverage while measuring nothing.

These numbers describe the external suites. They are not a claim about the
conformance suite in this repository, which is small and runs unconditionally.

## 5. Known drift to resolve

- **Resolved (annotations are not facts).** The reference demo used to stamp
  application annotations (`at`, and `roles` on Receipts) onto the recognized
  fact before storing it. The schema in `protocol/schemas/repid-fact.schema.json`
  is closed, so every persisted fact was invalid. The demo now stores the
  recognized fact verbatim and keeps the annotations in a separate
  `factAnnotations` map, keyed by txid, re-attached only when a response is
  rendered for the console — the API is the interpretation layer, the stored
  fact is not. State written before the change is migrated on load. The demo's
  `test/persistence_conformance.test.js` guards it: it reads the fact shapes from
  this schema and rejects any persisted fact that carries a key outside them.
- An earlier negative test in this repository wrongly suggested the artifact
  fingerprint would catch a logic change. It does not. The check now compares
  bytecode, ABI, source and debug bytecode.
