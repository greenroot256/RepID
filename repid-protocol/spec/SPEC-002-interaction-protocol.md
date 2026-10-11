# SPEC-002: Interaction Protocol

> **Scope.** This specification describes an **off-chain metadata layer**. It
> defines no fact, no tag and no on-chain transaction: the only thing it
> constrains is how an application must fill in the Receipt genesis of RFC-003
> for the result to mean what the parties intended. It is normatively relevant
> because the party order it fixes determines who may rate whom, but nothing it
> says is recognizable from the chain.
>
> Its reference implementation and its 9 tests live in the demo repository; see
> `REFERENCE-IMPLEMENTATION.md` (RF-M01, RF-I03).

## 1. Context and Objective

Before an Interaction Receipt (RFC-003) signed on-chain exists, there must be a clear, application-level definition of what interaction two parties are having and what role each one plays. The Interaction Protocol is the metadata layer — mostly off-chain — that an external application uses to describe that interaction before requesting its registration as a Receipt.

## 2. User Stories

- As an integrating external application, I want to define an interaction between two parties so I can later generate a jointly signed Interaction Receipt.
- As a party in an interaction, I want my role to be explicit from the start, so that the subsequent rating has context.

## 3. Functional Requirements (EARS Syntax)

- **RF-01** (Ubiquity): The system must allow an external application to define an interaction between exactly two parties (`partyA`, `partyB`).
- **RF-02** (Ubiquity): The system must require each interaction to specify an explicit role for each party.
- **RF-03** (Events): When an interaction is defined, the system must generate the metadata needed for the subsequent issuance of an Interaction Receipt (RFC-003).
- **RF-04** (Undesired Behavior): If an interaction does not specify roles for both parties, then the system must reject the interaction definition.

## 4. Non-Functional Requirements

- The Interaction Protocol operates mainly at the application level (off-chain); it does not impose its own on-chain transaction.
- It must remain agnostic to the specific business domain of the integrating application (buying/selling, freelancing, rentals, etc.).

## 5. Edge Cases and Constraints

- Interactions with more than two parties: not supported. `ReceiptGenesisValidator` (SPEC-003) fixes participation at exactly two signers. Group interactions are modeled as multiple pairwise receipts at the application layer.
- Ambiguous or empty roles → rejected per RF-04.

## 6. Out of Scope

- Multi-party interactions (>2).
- Cancellation or dispute flow for an interaction before it becomes a Receipt: **deliberately deferred** (2026-09-10). Its absence does not block the MVP: at the application layer, an interaction without agreement simply never issues its Receipt.
- On-chain persistence of the interaction definition (only the resulting Receipt is anchored on-chain, via SPEC-003).

## 7. Acceptance Criteria (Definition of Done)

- [x] The "Interaction" data model is formalized above, with the party order that fixes who rates whom.
- [x] Explicit-role validation is specified (RF-02, RF-04) and implemented with 9 tests in the reference implementation.
- [x] The "exactly 2 parties" assumption is confirmed as a design decision (see SPEC-003 §5).
- [ ] An independent integrating application has implemented this layer, which is the only thing that would demonstrate it is usable as written.
- [ ] The code complies with `constitution.md`.