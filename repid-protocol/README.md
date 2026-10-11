# RepID Protocol

The normative specification of **RepID**: a reputation protocol built on Bitcoin
Cash with CashTokens and CashScript.

This repository contains **specifications, canonical covenants, and the
conformance suite that defines what "conformant" means.** It contains no runtime
code. If you want to *use* RepID, take `repid-sdk`; if you want to *show* it
working, take the demo.

```text
repid-protocol   this repository   what RepID means, and how to check it
repid-sdk        separate          recognize facts, store and serve them
demo             separate          wallets, a console, an example app
```

## The one idea

**The blockchain stores immutable facts; the interpretation of those facts stays
off-chain.**

RepID records seven things on-chain: an identity was minted, its collateral was
increased, it was burned, a receipt was created, a rating was issued, a platform
confirmed the interaction, and a trust was declared. Everything a user actually
cares about — how reputable someone is, how much to trust them, how to weigh
their ratings — is computed off-chain, by whoever wants to, differently.

That separation is the protocol. It is also why the protocol is worth
specifying carefully: the chain is the durable part, and it has to stay
interpretable by people who were not in the room.

## What is here

| Path | What it is |
|---|---|
| `spec/` | The specifications. `SPEC-008` is the normative core. |
| `contracts/*.cash` | The covenant sources. **Normative**: this is the canonical text. |
| `artifacts/*.json` | Compiled covenants, verified reproducible. |
| `protocol/constants.json` | Tags, score bounds and byte lengths, machine-readable. |
| `protocol/schemas/` | JSON Schema for the seven fact types. |
| `protocol/protocol-version.json` | The protocol version, and what would promote it. |
| `conformance/` | The shared definition of conformant, with negative tests. |
| `tools/` | The checks that keep the above honest. |
| `constitution.md` | Non-negotiable principles. Prevails over any spec. |
| `REFERENCE-IMPLEMENTATION.md` | Where each requirement is implemented and tested. Non-normative. |

## Reading order

1. `constitution.md` — the principles, and why they are not negotiable.
2. `spec/SPEC-008-repid-protocol.md` — the protocol itself.
3. `spec/SPEC-009-repid-wire-format-and-recognition.md` — the bytes and the
   recognition algorithm.
4. `spec/SPEC-005-indexer-protocol.md` — what a recognizer must conclude, and
   from what state.
5. The rest, per feature.

## Verifying this repository

```bash
npm install
npm test                  # specs, requirement inventory, encoding, conformance suite
npm run specs:check       # no dead references, no missing specs
npm run requirements:check # the inventory still matches the specifications
npm run encoding:check    # no mojibake, no partly rewritten file
npm run artifacts:check   # every covenant recompiles to the committed artifact
```

`npm test` runs the first four of those, so a single command is enough.
`artifacts:check` reports `SKIPPED`, never `PASS`, if the compiler is missing.
A toolchain that is absent is not evidence of a correct artifact.

## Current state, stated honestly

The protocol is at **`0.2.0`**, not `1.0.0`. A leading zero says the
specification has **not** yet been verified by an independent implementation, and
that is true today. `protocol/protocol-version.json` lists the objective criteria
for `1.0.0`; the first is that someone outside this project implements these
rules and reaches the same conclusions.

Three gaps are declared rather than papered over, and each is recorded in the
specification that owns it:

- **The covenant ABI has no automated regression coverage.** The mock-based unit
  tests that provided it were removed, and `MockNetworkProvider` never ran the
  Bitcoin VM, so what was lost was ABI-shape regression coverage, not real-VM
  evidence. Covenant conformance rests on real-VM E2E runs, not on a test suite.
- **Some recognition rules still lack a negative test.** The `OP_RETURN` container
  rules and the Receipt-genesis shape rules are verified — 38 tests in the
  reference SDK (23 for container encoding, 15 for the Receipt genesis shape) —
  but seven vectors listed in `SPEC-009` Annex B.2 have no test yet, including a
  rating payload with no tracked Rating Right and a transaction that matches two
  recognizers at once.
- **The compiler-emitted artifact `fingerprint` is not a conformance anchor.** It
  does not change when a covenant's logic changes. `artifacts:check` compares the
  full artifact instead, and the check is itself verified by a negative test.

## Contributing

See `CONTRIBUTING.md`. The short version: the specification is the product, so a
change to behaviour without a change to `spec/` is an incomplete change, and a
requirement without a test is not done.

## License

MIT, `Copyright (c) 2026 RepID Contributors`. See `LICENSE`.
