# @repid/protocol

RepID protocol constants and normative specifications. This package is the **single
source of truth** for the machine-readable values the RepID protocol shares: the
on-chain `OP_RETURN` tags, the rating score range and the list of recognized fact types.

It carries **zero runtime dependencies** — any RepID implementation (indexer, wallet,
application) can import these constants without installing the reference stack.

## Installation

```bash
npm install @repid/protocol
```

## Constants

| Export | Value | Meaning |
|---|---|---|
| `REPID_RATING_TAG` | `'REPID_RATING1'` | `OP_RETURN` tag of an issued rating |
| `REPID_PLATFORM_TAG` | `'REPID_PLATFORM1'` | `OP_RETURN` tag of a platform confirmation |
| `REPID_TRUST_TAG` | `'REPID_TRUST1'` | `OP_RETURN` tag of a trust link |
| `MIN_SCORE` / `MAX_SCORE` | `1` / `5` | valid rating range (SPEC-004 RF-04) |
| `FACT_TYPES` | `['IDENTITY_GENESIS', …]` | every fact type the protocol can recognize |

## Specifications

The normative documentation ships inside the package (`spec/`):

- **SPEC-005** — Indexer Protocol (fact recognition)
- **SPEC-007** — Confidence Index (reputation interpretation, non-normative for the core)
- **SPEC-008** — RepID Protocol formal specification (**normative core**; prevails over
  SPEC-001..007 in case of conflict — see also `constitution.md`, Article 10)

`@repid/indexer` consumes these constants. The reference server/demo in the repository
root consumes the package the same way any external implementation would.