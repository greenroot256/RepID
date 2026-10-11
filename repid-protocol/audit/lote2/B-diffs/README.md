# Lote 2 — Deliverable B: per-file diffs (0.4.0 amendments)

This directory is **deliverable B** of the lote 2 audit: one `git` diff per
file, capturing the amendment that turns the repository's `0.3.0` content into
the `0.4.0` protocol described in `A-DECISIONES.md`.

Each diff was verified with `git apply --check` against its own file's baseline
(`applycheck=0` in the generation log) and the working tree was **restored to
the baseline after every diff** — the working repository is untouched. Nothing
here was applied, compiled, executed or run on a VM.

## How the diffs are generated

Two helpers in `C:\Users\mauri\AppData\Local\Temp\opencode\` produced them:

- `B-gen.ps1` copies the file's backup into `.bwork2/old/<rel>` and the edited
  working copy into `.bwork2/new/<rel>`, runs
  `git diff --no-index old new > <diff>` (through `cmd /c`, so the output is
  raw, not a UTF-16 PowerShell redirect), rewrites the path prefixes
  (`a/old/<rel>` → `a/<rel>`, `b/new/<rel>` → `b/<rel>`), normalizes line
  endings to `\n` and writes UTF-8 without BOM.
- `B-finalize.ps1` runs that generation, then **restores the working file from
  the backup** and runs `git apply --check` on the produced diff.

`git apply` may print CRLF warnings for a couple of files (the working files
are CRLF); the check still passes and the diffs are LF-normalized.

## The 11 diffs

| Diff | What it changes |
|---|---|
| `SPEC-003.diff` | Interaction Receipt: interaction context (RF-08), lifecycle (RF-09), self-corroboration invalid (RF-10), design decisions, out of scope, acceptance. |
| `SPEC-004.diff` | Rating Protocol: `RatingRightVault` covenant (RF-01), `REPID_RATING1`/`REPID_RATING2` and `commentHash` (RF-03/04/09), `REPID_RETRACT1` (RF-06/07), NFR, outliers, acceptance. |
| `SPEC-005.diff` | Indexer: receipt context (RF-23), `commentHash` (RF-24), `RATING_RETRACTION` (RF-25), self-corroboration invalid (RF-26), retained state (RF-27), ordering, edge cases, acceptance. |
| `SPEC-008.diff` | Normative core: eight events (E8 `RATING_RETRACTION`), model, `receiptContext`, `commentHash`, self-corroboration, burn delay 144 (RF-O831), verification rules, security matrix, out of scope, acceptance. |
| `SPEC-009.diff` | Wire format & recognition: five tags, `RF-W64`–`RF-W76` (§4.2/§4.3–§4.6, precedence, state, §9.2 context, §12.3 multi-version binding), Annex B.3 task-E vectors. |
| `SPEC-010.diff` | Versioning: `0.4.0` callout, eight facts, `MAJOR`/`MINOR` gaps, tags table. |
| `constants.diff` | `protocol/constants.json`: `REPID_RATING2_TAG`, `REPID_RETRACT_TAG`, `COMMENT_HASH: 32`, `receiptCommitment` (0/4/36, `0x10`/`0x11`), `commentHash` preimage (REPID-CMT-V1), `factTypes[7]` = `RATING_RETRACTION`, `identityVault.minBurnDelayBlocks: 144`. |
| `schema.diff` | `protocol/schemas/repid-fact.schema.json`: eight facts, `hash32`/`byteHex` definitions, `receiptContext` (E4), `commentHash` (E5), E8 `RATING_RETRACTION`. |
| `WHITE-PAPER.diff` | Presentation: eight facts, five tags, retraction, interaction context, `RatingRightVault`, burn delay, self-corroboration row, declared limitations. |
| `identity_vault.diff` | `contracts/identity_vault.cash`: `require(this.age >= 144)` in `burn()` + header note. **Not compiled, not VM-verified (task E).** |
| `covenant-bytecode.diff` | `protocol/covenant-bytecode.json`: versioned `identityVault` — `0.3.0` body intact, `0.4.0` **`PENDING` placeholder** (no bytecode) per SPEC-008 Annex A. |

## Deliberately NOT in this deliverable

- `protocol/protocol-version.json` is NOT bumped (`0.3.0` → `0.4.0`) — that is
  the conformance task F, downstream of task E.
- `contracts/rating_right.cash`, `receipt_genesis.cash`, `artifacts/*.json` are
  not changed: nothing about them is new in `0.4.0`.
- The repid-sdk recognizer and the demo remain on `0.3.0`: adding the second
  identity-vault body, the `RATING2`/`RETRACT` decoders, the receipt context and
  the self-corroboration check to executable code is task E.

## What applying these diffs implies (declared, not hidden)

Applying the diffs is **not** equivalent to having implemented `0.4.0`:

- `npm run bytecode:check` fails after applying `covenant-bytecode.diff`
  (and `identity_vault.diff`) until task E compiles the new body with `cashc`
  0.13.2 and the generator learns the version dimension. The `PENDING`
  placeholder exists precisely so no implementation can present the un-compiled
  body as verified bytecode.
- `npm test` schema/conformance tests that assert "seven facts" or the single
  flat identity-vault fingerprint would need their `0.4.0` counterparts — that
  is task E.
- Every `0.4.0`-only vector is listed as open in SPEC-009 Annex B.3 and is
  explicitly not claimed as covered anywhere in this audit.

## Verification command

```bash
git apply --check -v audit/lote2/B-diffs/<diff>
```

Run from the repository root. Each file's diff is self-contained (single-file,
`a/...`/`b/...` paths at the repo root).

## Revision (post-review, before closing B)

Two diffs were regenerated after the review pass surfaced traceability gaps:

- `SPEC-009.diff` — added the missing `RF-W71` declaration
  (self-corroboration) in §4.3, which the Annex B.3 row and §8 note already
  referenced but never declared. New declared count in SPEC-009: `RF-W64`–`RF-W76`
  minus unused `W75` (12), matching `A-DECISIONES`.
- `SPEC-008.diff` — `RF-O831` now names the actual constant
  `identityVault.minBurnDelayBlocks` (previously styled `MIN_BURN_DELAY_BLOCKS`)
  so the spec, the covenant header and `protocol/constants.json` all reference
  the same field.

Both were regenerated with `B-finalize.ps1` (`applycheck=0`, `restored=True`)
and are included in the count of 11 diffs below.

## Hygiene notes

- `.bwork/` and `.bwork2/` were scratch mirrors used during generation and were
  removed after the last diff.
- The working tree at the end of this deliverable is exactly the `0.3.0`
  baseline (uncommitted changes included); no diff was applied, no commit made.