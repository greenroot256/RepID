# Contributing to @repid/sdk

## The one rule

The protocol is the single source of truth, and this package is an implementation
of it. When the two disagree, the protocol is right and this package has a bug.

That means the normative files are never written here.
`src/protocol/constants.json`, `src/protocol/schemas/repid-fact.schema.json`,
`src/protocol/protocol-version.json` and the contract artifacts under
`test/fixtures/` are copies. They are refreshed with:

```sh
npm run sync:protocol
```

and `npm run check:drift` fails if they no longer match the protocol. If you find
yourself editing one of those files by hand, stop and change the protocol instead.

## Before you open a pull request

```sh
npm run check:all
```

which is typecheck, drift check and the full suite. If your change touches the
recognition rules, also say in the description which specification rule it
implements, and what would have to be true for it to be wrong.

## Conventions

- English for code, comments, tests, commit messages and documentation. This is
  settled and not a matter of taste.
- Comments explain *why*, not *what*. If a line needs a comment to say what it
  does, rename something instead.
- Public API is documented. Anything exported from `src/index.ts` or
  `src/node/index.ts` carries a doc comment saying what a caller can rely on.
- No cast to silence a type error. If a third-party type is too loose to work
  with, narrow it with a runtime check so the failure is a message rather than
  undefined behaviour.
- Two-space indentation, LF line endings, final newline. `.editorconfig` and
  `.gitattributes` enforce this.

## Continuous integration

CI is deliberately unable to pass without the protocol repository, because the
one thing that must never be wrong is whether these copies still match their
source. It therefore needs one repository setting, and it has no default:

| Setting | Kind | Required | Purpose |
|---|---|---|---|
| `PROTOCOL_REPOSITORY` | repository **variable** | always | the canonical protocol URL, cloned so `check:drift` compares against the real thing |
| `PROTOCOL_TOKEN` | repository **secret** | only if that repository is private | credentials for the clone |

Two details worth knowing, because both fail in a way that looks like something
else:

- A GitHub Actions *variable* is not an environment variable. It is only visible
  through the `vars` context, so the workflow maps it into the step with `env:`.
  Without that mapping the step sees an empty string even when the variable is
  set correctly, and reports "not set".
- The token is passed as an `http.extraheader`, not inside the URL. A token in
  the URL ends up in `.git/config` and in whatever the runner echoes.

Set them under **Settings → Secrets and variables → Actions**. Until the
protocol repository has a permanent home, CI is expected to fail its clone step
with an explicit message. That is the correct failure: it is refusing to report
drift agreement it never checked.

## Tests

Every requirement needs a test that fails without the change. "It works" is not
evidence; a test that fails when you revert the fix is.

A test that cannot fail is worse than no test, because it buys confidence it does
not deserve. When you add an assertion, check that it fails when the behaviour it
describes is broken.

Be explicit about what a test does not cover. The suite runs against a provider
that does not execute the Bitcoin VM, so it says nothing about covenant
execution, signature validity or consensus. Do not let a passing suite stand in
for that evidence; the protocol repository records the separate, real runs.

## Adding a fact type

1. Change the protocol first: the type, its schema, and the specification.
2. `npm run sync:protocol`.
3. Implement recognition, and the load-time cross-check in `src/constants.ts`
   will throw until you do, which is the intended order.
4. Add a test with a real transaction, and add the type to the schema conformance
   test so the shape is checked against the normative schema rather than against
   a hand-written object.

## Commits

Neutral authorship, no personal identifiers. Explain what was wrong and why the
fix is the right one, including what you checked. If a fix changes the set of
accepted inputs, say so and show how you verified the boundary.
