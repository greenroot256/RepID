# SPEC-001: Identity Protocol

## 1. Context and Objective

RepID needs an on-chain identity unit that is immutable, verifiable and independent of any central authority. This identity is the foundation on which the interactions and ratings of the rest of the protocol are built. It is implemented as an NFT (CashToken) minted a single time and locked in a **covenant vault** (`IdentityVault`) that its owner controls with their signature, together with a **BCH collateral** that remains locked while the identity exists.

The collateral has three on-chain properties guaranteed by the covenant:
1. **It is locked at minting** (amount > 0, chosen by the owner).
2. **It can never decrease on-chain**: any spend of the vault must re-lock a value greater than or equal to the locked one.
3. **It returns to the owner** when the identity is burned (the NFT disappears and the identity loses validity).

## 2. User Stories

- As a user, I want to create an immutable identity on the blockchain so I can participate in the reputation protocol without depending on a central authority.
- As a user, I want my identity to be unalterable and non-duplicable by anyone, including myself, so that it is trustworthy as a reputation anchor.
- As a user, I want to be able to **increase** the collateral of my identity over time (a growing-commitment signal), knowing that the covenant does not allow reducing it.
- As a user, I want to be able to **delete** my identity when I no longer need it, recovering the locked collateral.

## 3. Functional Requirements (EARS Syntax)

- **RF-01** (Ubiquity): The system must generate a genesis transaction that mints an immutable identity NFT and locks the collateral in the covenant vault.
- **RF-02** (Ubiquity): The covenant vault must require the NFT to hold `nftCommitment` equal to `ownerPkh` (20 bytes) and the owner to sign it in order to spend it.
- **RF-03** (Ubiquity): The genesis transaction must include a P2PKH change output to the owner that carries no minted tokens (it enables spending on the real network).
- **RF-04** (Undesired Behavior): If the outpoint spent in the genesis transaction has a `vout` other than 0, then the system must reject the transaction.
- **RF-05** (Undesired Behavior): If an identity NFT has already been minted from a given UTXO, then the system must prevent a second minting on the same UTXO (single-use covenant).
- **RF-06** (Ubiquity): The covenant vault must re-lock the NFT to the same covenant with `value` strictly greater than or equal to the locked collateral (the collateral can never decrease on-chain), and the excess must go to the owner as P2PKH change.
- **RF-07** (Ubiquity): The covenant vault must allow burning the NFT returning the collateral to the owner P2PKH, without the category reappearing in any output.
- **RF-08** (Options): Wherever the token category must be verified inside the covenant, the system must interpret the bytes returned by `tokenCategory` in reversed display order.
- **RF-09** (Reader compatibility): The indexer must recognize both the **vault** form (NFT to the covenant with `ownerPkh` commitment and collateral) and the **legacy** form (NFT directly to P2PKH, without collateral), so that identities minted before the vault are not broken.

## 4. Non-Functional Requirements

- The covenant must be implemented in CashScript (cashc 0.13.2).
- Mint-uniqueness verification relies on the UTXO single-use guarantees — it requires no external state.
- There are no critical performance requirements for the MVP (single transaction, no loops).

## 5. Edge Cases and Constraints

- Attempting to spend an outpoint with `vout != 0` in the genesis → transaction rejected by `MockNetworkProvider` with a token validation error, unrelated to the covenant's own logic.
- Byte-order confusion between `tokenCategory` (reversed) and libauth's `outpointTransactionHash` (already in display order) — they are opposite cases and must be treated separately.
- Collateral `<= 0` → rejected (the cashscript builder imposes the 741-sats dust floor on token outputs, so the VM is not even executed; the test covers it with a generic rejection).
- The category in a vault spend must be re-issued identically; a top-up is distinguished from a genesis because only the indexer knows the tracked outpoints (the spend is decoded *before* the genesis).
- A top-up is invalid if the new collateral is lower than the registered one or if the category/NFT does not match.

**Design decision (2026-09-10):**
- **Private-key loss**: accepted risk in the MVP. The identity is immutable and there is no on-chain recovery mechanism; a lost key means an irremediably lost identity. Users are recommended to back up their keys off-chain (custody of the seed/phrase), and the prototype documentation warns about this explicitly.

## 6. Out of Scope

See server/reputation.mjs and 	asks.md for details.

- Revocation mechanisms without destroying the identity (the burn removes the identity; the associated reputation remains as historical facts in the ledger). A possible revoke/re-issue design in a later cycle — not scheduled.
- Multi-signature or multi-owner identity (possible future RFC).
- KYC or off-chain identity verification.
- Collateral increase without re-issuance (the top-up re-locks the same NFT; it is not minted again).

## 7. Acceptance Criteria (Definition of Done)

- [x] The genesis transaction mints the NFT correctly locked in the covenant vault with its collateral.
- [x] A second minting attempt on the same UTXO is rejected.
- [x] The covenant requires the P2PKH change output to the owner and rejects hidden mintings.
- [x] The top-up re-locks the same NFT with collateral greater than or equal to the previous one; an attempt to reduce it or to sign without being the owner is rejected.
- [x] The burn returns the collateral to the owner and the category does not reappear; the indexer records it as `IDENTITY_BURNED` and the identity loses validity (a new one can be minted).
- [x] The indexer tracks the vault outpoints (a top-up moves the tracking) and persists the identities (25 tests: 17 `IdentityVault` covenant + 5 indexer vault + 3 E2E).
- [ ] The code complies with `constitution.md`.