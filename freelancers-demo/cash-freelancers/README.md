# Cash Freelancers

A Fiverr/Upwork-style freelance marketplace with global payments on
Bitcoin Cash: minimal fees, on-chain escrow (CashScript), and portable
reputation via RepID.

## Structure

```
apps/
  web/          Next.js — job postings, profiles, user dashboard
  api/          Node/TS (Fastify) — API, escrow state, Postgres
packages/
  contracts/    CashScript escrow contracts (bilateral + arbitrated) + wrappers
  shared/       Shared TypeScript types (User, Job, Escrow)
  wallet-connect/  WalletConnect BCH pairing and signing
```

## How to run

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL, WALLETCONNECT_PROJECT_ID, etc.

pnpm dev:web   # http://localhost:3000
pnpm dev:api   # http://localhost:4000/health
```

## Arbitrated escrow contract (2-of-3)

`packages/contracts/src/escrow-arbitrated.cash` is the second contract:
client, freelancer, and arbiter, where any two of the three can jointly
authorize spending the funds to whatever destination they agree on —
the classic 2-of-3 trust model:

- client + freelancer agree (no arbiter needed at all)
- freelancer + arbiter (arbiter rules in the freelancer's favor)
- client + arbiter (arbiter rules in the client's favor)

**Important implementation detail:** it deliberately avoids CashScript's
`checkMultiSig` (`OP_CHECKMULTISIG`). On BCH that opcode only accepts
legacy ECDSA signatures — I confirmed this empirically, a first version
built with `checkMultiSig` failed with *"Program used a schnorr-sized
signature in a legacy-mode (ECDSA) OP_CHECKMULTISIG operation"*. ECDSA
would have broken the Schnorr-based WalletConnect placeholder convention
the rest of the project depends on. The contract uses two independent
`checkSig` calls instead, which gives the same 2-of-3 guarantee and
stays Schnorr-compatible.

**Validation done:** compiled against real `cashc` 0.13.3, and an
end-to-end smoke test with a simulated provider covers: all three valid
2-of-3 combinations spending successfully with real signatures, the same
signer being rejected when used twice, and `generateWcTransactionObject()`
producing a valid WalletConnect object for this contract too.

`packages/contracts/src/escrow-arbitrated.ts` exposes
`createEscrowArbitratedContract({ clientPkh, freelancerPkh, arbiterPkh })`
and `buildSpendWcTransaction(contract, destinationAddress)`, which
returns a `WcTransactionObject` with **both** signer slots left as
placeholders. `apps/api/src/routes/escrows.ts` exposes this as
`GET /escrows/:id/arbitrated-spend-transaction?outcome=release|refund`,
resolving the contract's parties from Postgres (see "Data repositories &
API routes" below).

### Two-step signing

The bilateral contract's `release`/`reclaim` only ever needs **one**
person's wallet to sign, so `signTransaction` from
`@cash-freelancers/wallet-connect` is enough on its own — and that path
is fully wired and tested.

The arbitrated contract's `spend` needs signatures from **two different
people** (e.g. the freelancer's wallet and the arbiter's wallet), each
with their own separate WalletConnect session, likely at different times
from different devices — a materially different, harder problem than
the bilateral case. `@cash-freelancers/wallet-connect` now exposes it as
two separate steps:

- `startTwoPartySignature(config, firstSignerSession, wcTransactionObject)` —
  sends the placeholder object (both slots empty) to the first
  co-signer's wallet. A WC2-BCH-compliant wallet is expected to fill in
  only the placeholder slot that matches a key it holds, and leave the
  other slot's placeholder untouched. The contract treats both slots
  interchangeably on purpose (`pk1`/`pk2` are checked against the same
  three parties), so it doesn't matter which one the wallet picks.
- `completeTwoPartySignature(config, secondSignerSession, partiallySignedTransactionHex, sourceOutputs)` —
  takes the first step's result (its `signedTransaction`, a hex string —
  the WC2-BCH spec accepts a hex-encoded transaction directly, no need
  to turn it back into an object) and asks the second co-signer's wallet
  to complete it.

They're separate, independently-callable functions rather than one call
taking both sessions, because the two signers are two different people
who won't be acting in the same browser session — whatever orchestrates
this (the API — see "Data repositories & API routes" below) persists
the first step's `signedTransaction` hex until the second co-signer is
ready. `sourceOutputs` doesn't need to be persisted separately: since
the UTXO is still unspent between the two steps, calling
`buildSpendWcTransaction` again regenerates an equivalent one.

**Validation done, without a real wallet:** `packages/contracts/scripts/simulate-arbitrated-signing.ts`
(`pnpm --filter @cash-freelancers/contracts simulate:two-party`) confirms
the transaction mechanics these two functions depend on: a contract
input can mix one real signature with one still-placeholder pair in the
same call, the result survives a hex encode/decode round-trip byte for
byte, and the untouched placeholder is still detectable afterwards —
exactly what a second wallet would need to find and complete. It also
confirms a fully co-signed transaction (both real signatures) is valid
and spendable.

**What's still unverified:** whether real wallets (Cashonize/Paytaca/
Zapit) actually implement this — correctly picking one of two
placeholder slots to fill, and correctly re-signing a `transaction`
that's a hex string with one slot already real. There's no wallet-side
reference implementation available to test against locally, only the
dApp side. Treat this as the next thing to validate against a real
wallet, not as proven end to end.

## Signing wired to the contracts (release / reclaim)

`packages/contracts/src/escrow-bilateral.ts` exposes, besides
`createEscrowBilateralContract`, two functions that build the real
transaction using CashScript's `TransactionBuilder`:

- `buildReleaseWcTransaction(contract, freelancerAddress)`
- `buildReclaimWcTransaction(contract, freelancerAddress)`

Both use `placeholderPublicKey()`/`placeholderSignature()` — utilities
that CashScript SDK 0.13 ships for this exact case — to leave the user's
pubkey and signature unfilled, and `generateWcTransactionObject()` to
return the object already formatted per the WalletConnect BCH spec.
That object is exactly what `signTransaction` from
`@cash-freelancers/wallet-connect` expects (it now serializes with
libauth's safe `stringify` instead of the earlier, approximate type).

`apps/api/src/routes/escrows.ts` wires all of this up against real data
in Postgres — see "Data repositories & API routes" below for the full
route list:

- `GET /escrows/:id/release-transaction`
- `GET /escrows/:id/reclaim-transaction`

Both return `{ contractAddress, wcTransactionObject }`, ready for the
frontend to pass to `signTransaction(config, session, wcTransactionObject)`.

**Validation done:** the contract compiled against the real `cashc` 0.13.3,
and I ran an end-to-end smoke test (contract + simulated UTXO with
`MockNetworkProvider` + `TransactionBuilder`) for both paths, `release`
and `reclaim` — they generate the `WcTransactionObject` correctly. Along
the way I found and fixed an important detail: CashScript expects
`bigint` for the contract's `int` arguments (like `timeout`), not
`number` — that's why the API route converts the value coming from the
body with `BigInt(...)`.

What's still missing for this to work with a real wallet: testing it
against Cashonize/Paytaca/Zapit for real (the smoke test uses a
simulated provider, not a real wallet or network), and — once the wallet
returns `signedTransaction` — broadcasting it to the network (with
`provider.sendRawTransaction`, or letting the wallet do it if
`broadcast: true` is requested).

## Wallet connection (WalletConnect BCH)

`packages/wallet-connect` implements the BCH profile of WalletConnect v2
("WC2-BCH"): the convention that **Cashonize**, **Paytaca**, and
**Zapit** support today, documented by its author at
[mainnet-pat/wc2-bch-bcr](https://github.com/mainnet-pat/wc2-bch-bcr).
Worth noting: **it isn't a formal BCH standard yet**, it's a community
convention that may keep evolving — worth checking that source from
time to time.

Exposes:
- `connectWallet(config)` — starts pairing, returns `{ uri, approval }`.
  `uri` is shown as a QR code; `approval()` resolves with
  `{ topic, address, network }` once the user approves from their wallet.
- `restoreSession(config, topic)` — recovers an already-approved session
  (by a topic saved on the client side) without asking for the QR again.
- `disconnectWallet`, `signMessage`, `signTransaction` — the latter is
  now wired to the real transactions built by
  `@cash-freelancers/contracts` for the escrow (release/reclaim).

`apps/web/app/components/ConnectWalletButton.tsx` uses it: "Connect
wallet" button → QR → once approved, shows the connected address. It
needs a `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (free at
[cloud.walletconnect.com](https://cloud.walletconnect.com)).

## Bilateral escrow contract (CashScript)

`packages/contracts/src/escrow-bilateral.cash` has the real logic
(compiled and validated against `cashc` 0.13.3), with two functions:

- **`release(pk, sig)`** — only the client can call it; releases the full
  payment to the freelancer. Happy path.
- **`reclaim(pk, sig)`** — only the freelancer can call it, and only
  after the `timeout`; lets them get paid without needing the client's
  signature if the client never approved or disputed.

It has no refund-to-client path on purpose: a genuine dispute is handled
by `EscrowArbitrated` (2-of-3, see below), not here.

The wrapper `packages/contracts/src/escrow-bilateral.ts` compiles the
`.cash` file and exposes `createEscrowBilateralContract({ clientPkh, freelancerPkh, timeout })`,
which returns `cashscript`'s `Contract` object (with `.address`,
`.getUtxos()`, `.unlock.release(...)`, `.unlock.reclaim(...)`). Heads
up: **it hasn't been audited** — it's the MVP's foundation, not
something to hold real funds with before an external review.

## Data model (Postgres)

`apps/api/migrations/0001_init.sql` has the full schema: `users`,
`user_roles` (a user can be a client, freelancer, and arbiter at once),
`repid_links` (an optional, 1-to-1 link to a RepID identity),
`arbiter_profiles`, `jobs`, `proposals`, `escrows` (with a `CHECK` that
requires an arbiter only in `arbitrated` mode), `disputes`, and
`ratings` (with `repid_synced` to know which ratings have already been
written on-chain). `0002_escrow_pending_signature.sql` adds the columns
`escrows` needs for the two-step co-signing flow (see below).
`0003_auth.sql` adds `auth_challenges` and `sessions` for wallet-native
login (see "Authentication" below).

To run them:

```bash
pnpm --filter api migrate
```

The runner (`apps/api/src/db/migrate.ts`) applies the `.sql` files under
`migrations/` in order and keeps track of which ones already ran in
`schema_migrations`, so it's safe to run again.

## Authentication — wallet-native, no passwords

Since identity here already IS a BCH wallet, login is: prove you hold
the private key behind a wallet address by signing a one-time message,
the same way `signMessage` in `@cash-freelancers/wallet-connect` already
lets the frontend ask a connected wallet to sign something.

`apps/api/src/utils/bch-message.ts` implements the standard "Bitcoin
Signed Message" scheme (magic-prefixed, varint-length, double-sha256 —
the same convention Electron Cash and most BCH wallets use) with
`verifyMessage(message, signatureBase64, address)`, recovering the
pubkey from the signature and checking its hash160 against the address.
I wrote this myself rather than reusing `mainnet-js`'s `SignedMessage`
class: its `verify()` guesses the ECDSA recovery id from the address's
network prefix instead of using the one `libauth`'s
`signMessageHashRecoverableCompact` actually returns — looked wrong, so
this implementation carries the real recovery id through instead.
Validated with a sign → verify round trip: correct message and address
→ valid; a tampered message → rejected; the right message against the
wrong address → rejected.

Flow (`apps/api/src/routes/auth.ts`):

1. `POST /auth/challenge` — body `{ walletAddress }`. Returns a
   `challengeId` and a `message` to sign (embeds a nonce and a
   timestamp, expires in 5 minutes).
2. Frontend passes `message` to `signMessage` from
   `@cash-freelancers/wallet-connect`, gets the wallet's signature.
3. `POST /auth/verify` — body `{ challengeId, signature }`. Checks the
   challenge hasn't expired or been used, verifies the signature, marks
   the challenge used, and — creating the user first if this wallet has
   never been seen before, since the wallet itself is the proof of
   identity — returns `{ token, user }`.
4. Subsequent requests send `Authorization: Bearer <token>`.
   `apps/api/src/auth/session.ts`'s `requireAuth` preHandler resolves it
   to `request.authenticatedUserId` — only the session token's SHA-256
   is stored in `sessions.token_hash`, same principle as a password
   hash.
5. `POST /auth/logout` deletes the session; `GET /auth/me` is a quick
   way to check who a token belongs to.

Retrofitted onto the routes where trusting a client-supplied id would
matter most — instead of a body field, the id now comes from the
session, and each of these also checks the caller is the right party:

- `POST /jobs` — `clientId` is the session user
- `POST /jobs/:id/assign-freelancer` — must be the job's client
- `POST /jobs/:jobId/proposals` — `freelancerId` is the session user
- `POST /proposals/:id/accept`, `POST /proposals/:id/reject` — must be
  the job's client
- `POST /escrows` — must be the job's client
- `POST /escrows/:escrowId/disputes` — `openedBy` is the session user;
  must be the escrow's client or freelancer
- `POST /disputes/:id/resolve` — `resolvedBy` is the session user; must
  be the escrow's arbiter

**Validation done, against the real running server:** two full test
scripts, driving everything over real HTTP with `fetch` (not calling
functions directly) against real Postgres:

- Challenge → sign → verify → token; using that challenge a second time
  → `409`; `GET /auth/me` with the token → the right user;
  `POST /jobs` with no token → `401`; with the token → the job's
  `clientId` matches the session user; a *different* keypair signing
  *someone else's* challenge → `401`; logout, then reusing the token →
  `401`.
- Two real logged-in users, Alice (client) and Bob (freelancer): Bob
  can't accept his own proposal (`403`), Alice can; Bob can't open an
  escrow on Alice's job (`403`), Alice can; a random third party can't
  open a dispute on that escrow (`403`); Bob, an actual party, can.

**What's still open:** `ratings`, `arbiter-profile`/`repid` endpoints,
`reject` beyond what's listed above, and the two-step signing
persistence routes still trust whatever id is in the request body — not
retrofitted yet, same honest gap as before, just smaller.

## Data repositories & API routes

`apps/api/src/db/repositories/` has real, working data access for every
table in the schema: `users`, `jobs`, `proposals`, `escrows`, `disputes`,
`ratings`, `arbiter-profiles`. `escrows.createEscrow` is more than a
plain insert: it looks up the job's client/freelancer (and arbiter, for
`arbitrated` mode), derives each one's pkh from their `wallet_address`
with `pkhFromAddress` (`apps/api/src/utils/address.ts`, using libauth's
`decodeCashAddress` — no separate pkh column, the address already
encodes it), and instantiates the real contract so `contract_address`
is always the actual covenant address, never something a caller
computes and passes in.

HTTP routes wired up so far:

- `POST /auth/challenge`, `POST /auth/verify`, `POST /auth/logout`,
  `GET /auth/me` — see "Authentication" above
- `POST /users`, `GET /users/:id`, `POST /users/:id/repid`
- `POST /jobs`, `GET /jobs/:id`, `POST /jobs/:id/assign-freelancer`
- `POST /jobs/:jobId/proposals`, `GET /jobs/:jobId/proposals`,
  `POST /proposals/:id/accept`, `POST /proposals/:id/reject` — accepting
  a proposal is a transaction: marks it `accepted`, assigns its
  freelancer to the job (flips the job to `in_progress`), and rejects
  every other proposal on the same job, so a job can't end up with two
  accepted proposals
- `POST /escrows`, `GET /escrows/:id`
- `GET /escrows/:id/release-transaction`, `GET /escrows/:id/reclaim-transaction` (bilateral)
- `GET /escrows/:id/arbitrated-spend-transaction?outcome=release|refund` (arbitrated)
- `POST /escrows/:id/arbitrated-spend/first-signature`,
  `GET /escrows/:id/arbitrated-spend/pending`,
  `POST /escrows/:id/arbitrated-spend/final-signature` — the two-step
  flow's persistence (see above): step 1 stores the first co-signer's
  partially-signed hex + the intended `outcome` (`release`/`refund`);
  step 2's caller fetches it back (with freshly-regenerated
  `sourceOutputs`) to complete it; the final call records the result and
  sets the escrow's status to `released`/`refunded`.
- `POST /escrows/:id/broadcast` — broadcasts an already fully-signed raw
  transaction via `broadcastRawTransaction` from
  `@cash-freelancers/contracts`. Needed only if the wallet itself wasn't
  asked to broadcast (`broadcast: true` on the `WcTransactionObject`).
- `POST /escrows/:escrowId/disputes`, `GET /escrows/:escrowId/disputes`,
  `POST /disputes/:id/resolve` — opening a dispute flips the escrow's
  status to `disputed`. Resolving one only records the arbiter's written
  ruling (free text); it's a separate step from actually executing that
  ruling on-chain, which goes through the `arbitrated-spend-transaction`
  + two-step signing routes above with a matching `outcome`
- `POST /jobs/:jobId/ratings`, `GET /users/:id/ratings`
- `POST /users/:id/arbiter-profile`, `GET /users/:id/arbiter-profile`,
  `GET /arbiters` (active arbiters, most disputes resolved first)

Every table in the schema now has both a repository and HTTP routes.

**Validation done, against a real Postgres — not just types:** installed
Postgres 16 locally, ran both migrations against it, started the actual
Fastify server, and drove the whole flow with `curl`:

- Created a client, a freelancer, and an arbiter (with real BCH
  addresses), a job, assigned the freelancer, and created both an
  `arbitrated` and a `bilateral` escrow — each one's `contractAddress`
  came back as a real, correctly-computed CashScript address.
- The `escrows_job_id_key` unique constraint correctly rejected a second
  escrow on the same job.
- The full two-step signing persistence cycle: `GET .../pending` before
  any signature → `404`; `POST .../first-signature` → `204`, confirmed
  in the database; `POST .../final-signature` → `200`, escrow `status`
  flipped to `released` and `releaseTxid` set; calling
  `.../final-signature` again with nothing pending → `409`.
- A job with two competing proposals: accepting one correctly assigned
  its freelancer to the job (job flipped to `in_progress`) and
  auto-rejected the other, in one transaction.
- A dispute: opening one flipped the escrow to `disputed`; resolving it
  recorded the arbiter's ruling and flipped the dispute to `resolved`.
- A rating, and the `ratings_job_id_rater_id_ratee_id_key` unique
  constraint correctly rejecting a duplicate one.
- An arbiter profile: created, fetched, and listed under `/arbiters`;
  `404` for a user with no profile.
- 404s for missing users/jobs/escrows.

**What's still unverified:** the routes that build a `WcTransactionObject`
(`.../release-transaction`, `.../reclaim-transaction`,
`.../arbitrated-spend-transaction`, `.../arbitrated-spend/pending`) call
`contract.getUtxos()` internally, which needs a live connection to a
real Electrum server — not reachable from the sandbox this was built in
(same limitation as the wallet-signing pieces above). Everything up to
that network call — the DB lookups, pkh derivation, contract
reconstruction matching the stored address — is exercised by the tests
above; the live-network part isn't.

## Current status

What's working:
- Monorepo with pnpm workspaces (apps/web, apps/api, packages/contracts, packages/shared, packages/wallet-connect)
- Next.js with a minimal landing page + wallet connection button (QR)
- Full data model in Postgres + migration runner, with real repositories
  and HTTP routes for every table — tested end to end against a real
  local Postgres instance, not just typed
- Shared types aligned with the schema: `User`, `Job`, `Escrow`,
  `Proposal`, `Dispute`, `Rating`, `ArbiterProfile`
- `EscrowBilateral` contract in CashScript, compiled, validated with an
  end-to-end smoke test, with its TS wrapper
- `EscrowArbitrated` contract (2-of-3) in CashScript, compiled, validated
  with an end-to-end smoke test (all three valid signer pairs + rejection
  of a duplicate signer), with its TS wrapper
- Wallet connection via WalletConnect (BCH profile), compatible with
  Cashonize/Paytaca/Zapit
- `signTransaction` from wallet-connect already wired to
  `EscrowBilateral`'s real transactions (`release`/`reclaim`), resolved
  from Postgres instead of taken on faith from the caller — still needs
  testing against a real wallet and a live Electrum server
- Two-step co-signing (`startTwoPartySignature`/`completeTwoPartySignature`)
  for `EscrowArbitrated.spend`, with its transaction mechanics validated
  locally (`simulate:two-party`) and its in-between state persisted in
  Postgres (tested end to end with curl) — still needs testing against
  real wallets and a live network
- Wallet-native authentication (sign a challenge, get a session token —
  no passwords), retrofitted onto the routes where it matters most
  (creating jobs/proposals/escrows/disputes, accepting/rejecting
  proposals, resolving disputes), tested end to end over real HTTP
  against a real running server
- The whole monorepo passes `pnpm -r typecheck` with no errors

What's still missing (next stages, not included yet):
- Test the signing against a real wallet (Cashonize/Paytaca/Zapit) and a
  live Electrum server, and broadcast the signed transaction
- RepID reputation adapter (today `ratings.repid_synced` only reserves
  the spot)
- Auth isn't retrofitted everywhere yet — `ratings`,
  `arbiter-profile`/`repid`, and the two-step signing persistence routes
  still trust whatever id is in the request body
