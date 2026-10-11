# Contributing to RepID Protocol

This repository is the normative specification of RepID. That changes what
"contributing" means here: the goal is not to add features, it is to make the
protocol **unambiguous, checkable and implementable by someone who was not in
the room**.

## The rules that matter

These come from `constitution.md`, which prevails over any specification. They
are not style preferences.

1. **A requirement without an executed test is not implemented.** If you add an
   `RF-*`, add the test that demonstrates it, and run it. Do not report a result
   you did not observe.
2. **Every Functional Requirement must have a real test backing it before being
   considered complete.** When there is none, say so in the specification. An
   unchecked box that means "not done" is useful; one that means "probably fine"
   is not.
3. **The specification is the product.** A change to behaviour without a change
   to `spec/` is an incomplete change, and a change to `spec/` without a change
   to the code is a false promise.
4. **"Out of Scope" is law.** Anything marked out of scope is not implemented,
   however trivial it looks, until a new version of that specification includes
   it. This is the main defence against scope creep.
5. **Record what you do not know.** Unverified claims, tooling limitations and
   coverage gaps are part of the deliverable. Declaring a gap is free; a reader
   discovering it later is expensive.

## Before you open a pull request

```bash
npm install
npm test                  # specs, requirement inventory, encoding, conformance suite
npm run specs:check       # dead references and missing specs
npm run requirements:check # the inventory still matches the specifications
npm run encoding:check    # no mojibake, no partly rewritten file
npm run artifacts:check   # covenants still reproduce
```

`npm test` runs everything except `artifacts:check`, so a single command covers
most of it. If `artifacts:check` reports `SKIPPED` because the compiler
is unavailable, say so in the pull request; do not present it as a pass.

`requirements:check` exists because a requirement added to a specification must
not be able to enter the world unnoticed. `build-requirements.mjs` extracts every
declaration into `protocol/requirements.json`; if you add, remove or reword a
requirement, run `npm run requirements:build` and commit the result in the same
change. A CI failure here means the inventory and the specifications disagree,
which is exactly what it is for.

## Writing a specification

- **Be normative about the right things.** State the rule that an independent
  implementer must satisfy. Leave UI, storage, transport and reputation out.
- **Distinguish the three outcomes**: a valid fact, an *invalid* attempt
  (recognized, `valid: false`) and *not a fact at all* (`null`). Collapsing them
  is the most common way a recognizer ends up wrong.
- **Never drop an invalid fact.** Reporting that something was attempted and
  rejected is part of the protocol's value.
- **Do not reference another repository as if it were local.** Use `ref:` for
  paths that live elsewhere; `npm run specs:check` enforces this. A dead link in
  a normative document is worse than no link, because the reader cannot tell
  whether the claim behind it still holds.
- **State the byte order.** "Reversed display order" inside a covenant and
  "display order" from a decoder are different things, and confusing them has
  cost this project real debugging time.

## Changing a covenant

Covenants are consensus-adjacent: changing one changes what historical
transactions meant. Treat it as a protocol version change under `SPEC-010`, and
say explicitly whether it is breaking.

Run `npm run artifacts:check`. Do **not** pin conformance to the `fingerprint`
field — it does not change when a covenant's logic changes, which was measured,
not assumed.

## Changing a fact's shape

Any change to a fact type, field, encoding, tag or recognition precedence is
`MAJOR` under `SPEC-010`. The invariant: **a `MAJOR` change is one that could
alter how a historical transaction is read.** There is no exception for small
changes. Update `protocol/constants.json`, `protocol/schemas/` and the
conformance vectors in the same commit, and state the migration story — which,
for a protocol whose chain is immutable, is "old facts are read under the rules
that produced them".

## Style

- English for everything committed: specifications, code, comments, commit
  messages, test names.
- Amounts in satoshis are **strings**, never JSON numbers: BCH amounts exceed the
  IEEE-754 safe integer range.
- Declare known limitations instead of writing around them in silence.

## Reporting a specification bug

If two implementations reach different conclusions from these documents, that is
a specification defect, and it is the most valuable kind of report this project
can receive. Open an issue with both conclusions and the transactions that led
to them. Do not patch around it in an implementation first.
