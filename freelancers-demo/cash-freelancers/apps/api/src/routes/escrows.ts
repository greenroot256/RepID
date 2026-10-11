import type { FastifyInstance } from "fastify";
import {
  createEscrowBilateralContract,
  createEscrowArbitratedContract,
  buildReleaseWcTransaction,
  buildReclaimWcTransaction,
  buildSpendWcTransaction,
  broadcastAndVerifyFunding,
  assertFundingStillSpendable,
  broadcastAndVerifySpend,
  expectedPayoutSats,
  readAddressBalance,
  buildFundingWcTransaction,
  fetchSpendableUtxos,
  type EscrowBilateralContract,
  type EscrowArbitratedContract
} from "@cash-freelancers/contracts";
import {
  serializeWcValue,
  type Escrow,
  type EscrowMode,
  type Job,
  type User
} from "@cash-freelancers/shared";
import { escrowsRepo, jobsRepo, usersRepo } from "../db/repositories/index.js";
import { pkhFromAddress } from "../utils/address.js";
import { parseTransactionHex } from "../utils/hex.js";
import { requireAuth } from "../auth/session.js";
import {
  requireEscrowParty,
  requireEscrowClient,
  requireEscrowFreelancer
} from "../auth/escrow-access.js";
import { network } from "../config.js";

interface CreateEscrowBody {
  jobId: string;
  mode: EscrowMode;
  amountSats: number;
  arbiterId?: string;
  timeoutAt?: string; // ISO date, required for "bilateral"
}

/**
 * What `loadEscrowContract` returns. The two modes instantiate different
 * contract types, and only bilateral escrows carry a `timeout`, so the result
 * is a discriminated union: checking `kind` narrows both the contract and the
 * timeout, instead of leaving `timeout` as `bigint | undefined` at every call
 * site.
 */
type LoadedEscrow =
  | {
      kind: "bilateral";
      escrow: Escrow;
      job: Job;
      client: User;
      freelancer: User;
      contract: EscrowBilateralContract;
      timeout: bigint;
      wallets: EscrowWallets;
    }
  | {
      kind: "arbitrated";
      escrow: Escrow;
      job: Job;
      client: User;
      freelancer: User;
      arbiter: User;
      contract: EscrowArbitratedContract;
      wallets: EscrowWallets;
    };

/**
 * The addresses an escrow is locked to, read from the escrow rather than from
 * the parties' accounts.
 *
 * Every route that builds a transaction, fetches UTXOs or names a recipient
 * must use these. Reading `user.walletAddress` instead looks equivalent today
 * and silently stops being correct the moment a party activates a second
 * wallet: the covenant's public key hashes were fixed when the escrow was
 * created, so a transaction built against the new address would target an
 * output nobody controls and the funds would be unrecoverable until timeout.
 */
interface EscrowWallets {
  client: string;
  freelancer: string;
  arbiter?: string;
}

/** Re-derives the escrow's on-chain contract from its DB record — same
 *  parties, same mode, always the same address as when it was created.
 *  Used by every route below instead of trusting a client-supplied
 *  contract address. */
async function loadEscrowContract(escrowId: string): Promise<LoadedEscrow | undefined> {
  const escrow = await escrowsRepo.findEscrowById(escrowId);
  if (!escrow) return undefined;

  const job = await jobsRepo.findJobById(escrow.jobId);
  if (!job || !job.freelancerId) throw new Error(`Job for escrow ${escrowId} is incomplete`);

  const [client, freelancer] = await Promise.all([
    usersRepo.findUserById(job.clientId),
    usersRepo.findUserById(job.freelancerId)
  ]);
  if (!client || !freelancer) throw new Error(`Client or freelancer for escrow ${escrowId} not found`);

  const wallets: EscrowWallets = {
    client: escrow.clientWalletAddress,
    freelancer: escrow.freelancerWalletAddress,
    arbiter: escrow.arbiterWalletAddress
  };

  if (escrow.mode === "bilateral") {
    if (!escrow.timeoutAt) throw new Error(`Bilateral escrow ${escrowId} has no timeout stored`);
    // Single source of truth for the nLockTime: the contract address and the
    // reclaim transaction both derive from this one value.
    const timeout = BigInt(Math.floor(new Date(escrow.timeoutAt).getTime() / 1000));
    const contract = createEscrowBilateralContract({
      clientPkh: pkhFromAddress(wallets.client),
      freelancerPkh: pkhFromAddress(wallets.freelancer),
      timeout,
      network
    });
    return { kind: "bilateral", escrow, job, client, freelancer, contract, timeout, wallets };
  }

  if (!escrow.arbiterId) throw new Error(`Arbitrated escrow ${escrowId} has no arbiter stored`);
  if (!wallets.arbiter) throw new Error(`Arbitrated escrow ${escrowId} has no arbiter wallet stored`);
  const arbiter = await usersRepo.findUserById(escrow.arbiterId);
  if (!arbiter) throw new Error(`Arbiter for escrow ${escrowId} not found`);
  const contract = createEscrowArbitratedContract({
    clientPkh: pkhFromAddress(wallets.client),
    freelancerPkh: pkhFromAddress(wallets.freelancer),
    arbiterPkh: pkhFromAddress(wallets.arbiter),
    network
  });
  return { kind: "arbitrated", escrow, job, client, freelancer, arbiter, contract, wallets };
}

export async function escrowRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateEscrowBody }>("/escrows", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const job = await jobsRepo.findJobById(request.body.jobId);
      if (!job) {
        reply.status(404).send({ error: "Job not found" });
        return;
      }
      if (job.clientId !== request.authenticatedUserId) {
        reply.status(403).send({ error: "Only this job's client can open an escrow for it" });
        return;
      }
      const { timeoutAt, ...rest } = request.body;
      const escrow = await escrowsRepo.createEscrow({
        ...rest,
        timeoutAt: timeoutAt ? new Date(timeoutAt) : undefined
      });
      reply.status(201).send(escrow);
    } catch (err) {
      app.log.error(err);
      reply.status(422).send({ error: (err as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>("/escrows/:id", async (request, reply) => {
    const escrow = await escrowsRepo.findEscrowById(request.params.id);
    if (!escrow) {
      reply.status(404).send({ error: "Escrow not found" });
      return;
    }
    reply.send(escrow);
  });

  app.get<{ Params: { id: string } }>(
    "/escrows/:id/release-transaction",
    { preHandler: requireEscrowClient },
    async (request, reply) => {
      try {
        const loaded = await loadEscrowContract(request.params.id);
        if (!loaded) return reply.status(404).send({ error: "Escrow not found" });
        if (loaded.kind !== "bilateral") {
          return reply.status(400).send({ error: "This escrow is not bilateral" });
        }
        const wcTransactionObject = await buildReleaseWcTransaction(
          loaded.contract,
          loaded.wallets.freelancer
        );
        reply.send({
          contractAddress: loaded.contract.address,
          wcTransactionObject: serializeWcValue(wcTransactionObject)
        });
      } catch (err) {
        app.log.error(err);
        reply.status(422).send({ error: (err as Error).message });
      }
    }
  );

  // Only the freelancer can reclaim, and only because the covenant itself only
  // accepts the freelancer's signature on that path — the API must not offer
  // the client a reclaim transaction the contract would reject anyway.
  app.get<{ Params: { id: string } }>(
    "/escrows/:id/reclaim-transaction",
    { preHandler: requireEscrowFreelancer },
    async (request, reply) => {
      try {
        const loaded = await loadEscrowContract(request.params.id);
        if (!loaded) return reply.status(404).send({ error: "Escrow not found" });
        if (loaded.kind !== "bilateral") {
          return reply.status(400).send({ error: "This escrow is not bilateral" });
        }
        const wcTransactionObject = await buildReclaimWcTransaction(
          loaded.contract,
          loaded.wallets.freelancer,
          loaded.timeout
        );
        reply.send({
          contractAddress: loaded.contract.address,
          wcTransactionObject: serializeWcValue(wcTransactionObject)
        });
      } catch (err) {
        app.log.error(err);
        reply.status(422).send({ error: (err as Error).message });
      }
    }
  );

  app.get<{ Params: { id: string }; Querystring: { outcome: "release" | "refund" } }>(
    "/escrows/:id/arbitrated-spend-transaction",
    { preHandler: requireEscrowParty },
    async (request, reply) => {
      try {
        const loaded = await loadEscrowContract(request.params.id);
        if (!loaded) return reply.status(404).send({ error: "Escrow not found" });
        if (loaded.kind !== "arbitrated") {
          return reply.status(400).send({ error: "This escrow is not arbitrated" });
        }
        const { outcome } = request.query;
        if (outcome !== "release" && outcome !== "refund") {
          return reply.status(400).send({ error: "outcome must be 'release' or 'refund'" });
        }
        const destination =
          outcome === "release" ? loaded.wallets.freelancer : loaded.wallets.client;
        const wcTransactionObject = await buildSpendWcTransaction(loaded.contract, destination);
        reply.send({
          contractAddress: loaded.contract.address,
          wcTransactionObject: serializeWcValue(wcTransactionObject)
        });
      } catch (err) {
        app.log.error(err);
        reply.status(422).send({ error: (err as Error).message });
      }
    }
  );

  // --- Two-step co-signing (EscrowArbitrated.spend only) ---
  // See startTwoPartySignature/completeTwoPartySignature in
  // @cash-freelancers/wallet-connect and the root README's "Two-step
  // signing" section.

  app.post<{
    Params: { id: string };
    Body: { signedTransactionHex: string; signedBy?: string; outcome: "release" | "refund" };
  }>(
    "/escrows/:id/arbitrated-spend/first-signature",
    { preHandler: requireEscrowParty },
    async (request, reply) => {
      try {
        const loaded = await loadEscrowContract(request.params.id);
        if (!loaded) return reply.status(404).send({ error: "Escrow not found" });
        if (loaded.kind !== "arbitrated") {
          return reply.status(400).send({ error: "This escrow is not arbitrated" });
        }

        const { outcome, signedBy } = request.body;
        if (outcome !== "release" && outcome !== "refund") {
          return reply.status(400).send({ error: "outcome must be 'release' or 'refund'" });
        }

        // The signer is the authenticated session, not a value from the body.
        // Accepting `signedBy` at face value would let a party record a
        // pending signature as if a different party had produced it, and would
        // let one wallet overwrite another's half-signed transaction.
        //
        // It is stored as the user id because `pending_signature_by` is a
        // foreign key to users(id) (migration 0002), not a wallet address.
        // The database enforces that a recorded signer is a real user.
        if (request.body.signedBy && request.body.signedBy !== request.authenticatedUserId) {
          return reply.status(400).send({
            error: "signedBy must be the id of the authenticated session"
          });
        }

        // A second signer is required, so refuse to overwrite a pending
        // half-signature that someone else is still holding.
        const existing = await escrowsRepo.getPendingSignature(request.params.id);
        if (existing && existing.signedBy === request.authenticatedUserId) {
          return reply.status(409).send({
            error: "This wallet already submitted a first signature for this escrow"
          });
        }

        const signedTransactionHex = parseTransactionHex(request.body.signedTransactionHex);

        await escrowsRepo.savePendingSignature({
          escrowId: request.params.id,
          signedTransactionHex,
          signedBy: request.authenticatedUserId!,
          outcome
        });
        reply.status(204).send();
      } catch (err) {
        app.log.error(err);
        reply.status(422).send({ error: (err as Error).message });
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    "/escrows/:id/arbitrated-spend/pending",
    { preHandler: requireEscrowParty },
    async (request, reply) => {
      try {
        const pending = await escrowsRepo.getPendingSignature(request.params.id);
        if (!pending) return reply.status(404).send({ error: "No pending signature for this escrow" });

        const loaded = await loadEscrowContract(request.params.id);
        if (!loaded) return reply.status(404).send({ error: "Escrow not found" });
        if (loaded.kind !== "arbitrated") {
          return reply.status(400).send({ error: "This escrow is not arbitrated" });
        }

        // The wallet that already signed must not be handed its own
        // half-finished transaction as if it were the second party's job —
        // it is the one party that cannot complete a 2-of-3 on its own.
        if (pending.signedBy === request.authenticatedUserId) {
          return reply.status(409).send({
            error: "This wallet is the first signer; the pending transaction is awaiting the second party"
          });
        }

        const destination =
          pending.outcome === "release" ? loaded.wallets.freelancer : loaded.wallets.client;
        // Only used to regenerate matching sourceOutputs — its freshly
        // generated `transaction` field is discarded in favor of the
        // stored, partially-signed hex.
        const fresh = await buildSpendWcTransaction(loaded.contract, destination);

        reply.send({
          transaction: pending.signedTransactionHex,
          sourceOutputs: serializeWcValue(fresh.sourceOutputs),
          outcome: pending.outcome
        });
      } catch (err) {
        app.log.error(err);
        reply.status(422).send({ error: (err as Error).message });
      }
    }
  );

  // Completing the 2-of-3. This used to accept a bare `signedTransactionHash`
  // from the client and immediately write `released`/`refunded` into the DB —
  // asserting, on the client's word alone, that an on-chain transaction had
  // moved the escrow's money. It now takes the fully-signed transaction and
  // settles it through the same verified path as every other spend, so the
  // recorded txid is one the chain has actually accepted.
  app.post<{
    Params: { id: string };
    Body: { signedTransactionHex: string };
  }>(
    "/escrows/:id/arbitrated-spend/final-signature",
    { preHandler: requireEscrowParty },
    async (request, reply) => {
      try {
        const loaded = await loadEscrowContract(request.params.id);
        if (!loaded) return reply.status(404).send({ error: "Escrow not found" });
        if (loaded.kind !== "arbitrated") {
          return reply.status(400).send({ error: "This escrow is not arbitrated" });
        }
        if (loaded.escrow.status !== "funded") {
          return reply.status(409).send({
            error: `This escrow is ${loaded.escrow.status}; the spend requires it to be funded`
          });
        }
        if (!loaded.escrow.fundingTxid) {
          return reply.status(409).send({ error: "This escrow has no recorded funding transaction" });
        }

        const pending = await escrowsRepo.getPendingSignature(request.params.id);
        if (!pending) {
          reply.status(409).send({ error: "No pending signature to finalize for this escrow" });
          return;
        }

        // Completing a 2-of-3 needs a second, different party. Without this,
        // the first signer could finalize their own half and claim the escrow
        // was released.
        if (pending.signedBy === request.authenticatedUserId) {
          reply.status(403).send({
            error: "The first signer cannot also complete the transaction; a different party must co-sign"
          });
          return;
        }

        const signedTransactionHex = parseTransactionHex(request.body.signedTransactionHex);

        // Pre-broadcast: the escrow must still hold the agreed amount.
        await assertFundingStillSpendable({
          contract: loaded.contract,
          network,
          fundingTxid: loaded.escrow.fundingTxid,
          expectedSats: loaded.escrow.amountSats
        });

        const recipientAddress =
          pending.outcome === "release" ? loaded.wallets.freelancer : loaded.wallets.client;
        const payout = expectedPayoutSats(loaded.escrow.amountSats);
        const recipientBalanceBefore = await readAddressBalance(
          recipientAddress,
          network,
          loaded.contract
        );

        const txid = await broadcastAndVerifySpend({
          contract: loaded.contract,
          network,
          signedTransactionHex,
          fundingTxid: loaded.escrow.fundingTxid,
          recipientAddress,
          expectedPayoutSats: payout,
          recipientBalanceBefore
        });

        const escrow = await escrowsRepo.finalizeEscrow({
          escrowId: request.params.id,
          outcome: pending.outcome,
          releaseTxid: txid
        });
        reply.send(escrow);
      } catch (err) {
        app.log.error(err);
        reply.status(422).send({ error: (err as Error).message });
      }
    }
  );

  // --- Funding ---
  // The API cannot build the funding transaction itself: it is a plain P2PKH
  // spend out of the *client's* wallet, and only the client's wallet knows
  // which UTXOs it has. So the API publishes the immutable terms and then
  // verifies the result.
  //
  // The amount deliberately never comes from the request. It is read from the
  // escrow record, which was agreed when the escrow was created — otherwise a
  // caller could fund a 40,000 sat escrow with 1 sat and the covenant would
  // happily release 1 sat while the DB claimed the full amount.

  app.get<{ Params: { id: string } }>(
    "/escrows/:id/funding-details",
    { preHandler: requireEscrowClient },
    async (request, reply) => {
      try {
        const loaded = await loadEscrowContract(request.params.id);
        if (!loaded) return reply.status(404).send({ error: "Escrow not found" });
        if (loaded.escrow.status !== "pending_funding") {
          return reply.status(409).send({
            error: `This escrow is already ${loaded.escrow.status}; it cannot be funded again`
          });
        }
        reply.send({
          contractAddress: loaded.contract.address,
          amountSats: loaded.escrow.amountSats,
          // Lets the wallet show the user what they will actually receive
          // after the covenant's fixed fee.
          payoutSats: Number(expectedPayoutSats(loaded.escrow.amountSats)),
          network,
          timeoutAt: loaded.escrow.timeoutAt,
          mode: loaded.escrow.mode
        });
      } catch (err) {
        app.log.error(err);
        reply.status(422).send({ error: (err as Error).message });
      }
    }
  );

  /**
   * The client's own escrows, for the dashboard. Registered before
   * `/escrows/:id` so the literal segment is not swallowed as an id.
   */
  app.get("/escrows/mine", { preHandler: requireAuth }, async (request, reply) => {
    const escrows = await escrowsRepo.listEscrowsForUser(request.authenticatedUserId!);
    reply.send(escrows);
  });

  /**
   * Builds the P2PKH transaction that locks the client's money into the
   * covenant, as a WalletConnect object for the client's wallet to sign.
   *
   * This is deliberately a separate GET from `funding-details`: the details are
   * static terms the UI can render anywhere, while this one hits Electrum and
   * depends on the wallet's current balance, so the UI can load it lazily only
   * when the user actually presses "fund".
   *
   * The client's UTXOs are gathered here rather than in the browser, for the
   * same reason every other WC object in this file is built server-side: the
   * browser never needs a compiler or an Electrum connection. No key material
   * is involved at all — `placeholderP2PKHUnlocker` produces empty unlocking
   * bytecode that only the wallet can fill.
   */
  app.get<{ Params: { id: string } }>(
    "/escrows/:id/funding-transaction",
    { preHandler: requireEscrowClient },
    async (request, reply) => {
      try {
        const loaded = await loadEscrowContract(request.params.id);
        if (!loaded) return reply.status(404).send({ error: "Escrow not found" });
        if (loaded.escrow.status !== "pending_funding") {
          return reply.status(409).send({
            error: `This escrow is already ${loaded.escrow.status}; it cannot be funded again`
          });
        }

        const utxos = await fetchSpendableUtxos(loaded.wallets.client, network);
        const { wcTransactionObject, fundingUtxos, feeSats } = await buildFundingWcTransaction({
          clientAddress: loaded.wallets.client,
          contractAddress: loaded.contract.address,
          amountSats: loaded.escrow.amountSats,
          utxos,
          network
        });

        reply.send({
          contractAddress: loaded.contract.address,
          // serializeWcValue, not JSON.stringify: the object carries bigint
          // satoshi amounts, which plain JSON.stringify refuses to encode, and
          // Uint8Array byte fields, which it would turn into index-keyed
          // objects the wallet cannot read.
          wcTransactionObject: serializeWcValue(wcTransactionObject),
          amountSats: loaded.escrow.amountSats,
          feeSats: Number(feeSats),
          // Reported so the UI can tell the user which coins are being spent
          // before they approve anything in their wallet.
          fundingUtxos: fundingUtxos.map((u) => ({
            txid: u.txid,
            vout: u.vout,
            satoshis: Number(u.satoshis)
          }))
        });
      } catch (err) {
        app.log.error(err);
        reply.status(422).send({ error: (err as Error).message });
      }
    }
  );

  app.post<{ Params: { id: string }; Body: { signedTransactionHex: string } }>(
    "/escrows/:id/funding",
    { preHandler: requireEscrowClient },
    async (request, reply) => {
      try {
        const loaded = await loadEscrowContract(request.params.id);
        if (!loaded) return reply.status(404).send({ error: "Escrow not found" });
        if (loaded.escrow.status !== "pending_funding") {
          return reply.status(409).send({
            error: `This escrow is already ${loaded.escrow.status}; it cannot be funded again`
          });
        }

        const signedTransactionHex = parseTransactionHex(request.body.signedTransactionHex);
        const txid = await broadcastAndVerifyFunding({
          contract: loaded.contract,
          network,
          signedTransactionHex,
          expectedSats: loaded.escrow.amountSats
        });

        const escrow = await escrowsRepo.markFunded(loaded.escrow.id, txid);
        reply.send(escrow);
      } catch (err) {
        app.log.error(err);
        // 422: the transaction was well-formed enough to broadcast, but it did
        // not do what it claimed. The DB is left untouched, so the escrow is
        // still `pending_funding` and can be funded correctly.
        reply.status(422).send({ error: (err as Error).message });
      }
    }
  );

  // --- Verified settlement ---
  // This replaced a route that broadcast whatever hex it was given and
  // returned the txid, ignoring `request.params.id` entirely. Nothing tied the
  // transaction to the escrow, and nothing was written to the DB, so an escrow
  // could be marked released on the strength of a transaction that paid
  // nobody.
  //
  // The purpose is explicit rather than inferred, and each one is checked
  // against the state machine and the caller's role before a single sat moves.

  type SettlementPurpose =
    | "funding"
    | "release"
    | "reclaim"
    | "arbitrated-release"
    | "arbitrated-refund";

  interface SettlementRule {
    requiredStatus: Escrow["status"];
    mode: Escrow["mode"] | "any";
    /** Which party may submit this settlement. */
    actor: "client" | "freelancer" | "party";
    recipient: "contract" | "freelancer" | "client";
    finalStatus: Escrow["status"];
  }

  const SETTLEMENT_RULES: Record<SettlementPurpose, SettlementRule> = {
    funding: {
      requiredStatus: "pending_funding",
      mode: "any",
      actor: "client",
      recipient: "contract",
      finalStatus: "funded"
    },
    release: {
      requiredStatus: "funded",
      mode: "bilateral",
      actor: "client",
      recipient: "freelancer",
      finalStatus: "released"
    },
    reclaim: {
      requiredStatus: "funded",
      mode: "bilateral",
      actor: "freelancer",
      recipient: "freelancer",
      finalStatus: "released"
    },
    "arbitrated-release": {
      requiredStatus: "funded",
      mode: "arbitrated",
      actor: "party",
      recipient: "freelancer",
      finalStatus: "released"
    },
    "arbitrated-refund": {
      requiredStatus: "funded",
      mode: "arbitrated",
      actor: "party",
      recipient: "client",
      finalStatus: "refunded"
    }
  };

  function checkSettlementAllowed(
    purpose: SettlementPurpose,
    rule: SettlementRule,
    loaded: LoadedEscrow,
    callerId: string
  ): string | undefined {
    if (rule.mode !== "any" && loaded.escrow.mode !== rule.mode) {
      return `This escrow is ${loaded.escrow.mode}, so '${purpose}' does not apply to it`;
    }
    if (loaded.escrow.status !== rule.requiredStatus) {
      return `This escrow is ${loaded.escrow.status}; this step requires it to be ${rule.requiredStatus}`;
    }
    if (rule.actor === "client" && loaded.client.id !== callerId) {
      return "Only this escrow's client can perform this step";
    }
    if (rule.actor === "freelancer" && loaded.freelancer.id !== callerId) {
      return "Only this escrow's freelancer can perform this step";
    }
    return undefined;
  }

  app.post<{
    Params: { id: string };
    Body: { signedTransactionHex: string; purpose: SettlementPurpose };
  }>("/escrows/:id/broadcast", { preHandler: requireEscrowParty }, async (request, reply) => {
    try {
      const loaded = await loadEscrowContract(request.params.id);
      if (!loaded) return reply.status(404).send({ error: "Escrow not found" });

      const purpose = request.body.purpose;
      const rule = purpose ? SETTLEMENT_RULES[purpose] : undefined;
      if (!rule) {
        return reply.status(400).send({
          error: `purpose must be one of: ${Object.keys(SETTLEMENT_RULES).join(", ")}`
        });
      }

      const denied = checkSettlementAllowed(purpose, rule, loaded, request.authenticatedUserId!);
      if (denied) return reply.status(403).send({ error: denied });

      const signedTransactionHex = parseTransactionHex(request.body.signedTransactionHex);

      if (rule.recipient === "contract") {
        const txid = await broadcastAndVerifyFunding({
          contract: loaded.contract,
          network,
          signedTransactionHex,
          expectedSats: loaded.escrow.amountSats
        });
        return reply.send(await escrowsRepo.markFunded(loaded.escrow.id, txid));
      }

      if (!loaded.escrow.fundingTxid) {
        return reply.status(409).send({ error: "This escrow has no recorded funding transaction" });
      }

      // Pre-broadcast: the escrow must still actually hold the agreed amount,
      // so a stale or replayed spend cannot be "verified" against funds that
      // are already gone.
      await assertFundingStillSpendable({
        contract: loaded.contract,
        network,
        fundingTxid: loaded.escrow.fundingTxid,
        expectedSats: loaded.escrow.amountSats
      });

      const recipientAddress =
        rule.recipient === "freelancer" ? loaded.wallets.freelancer : loaded.wallets.client;
      const payout = expectedPayoutSats(loaded.escrow.amountSats);
      const recipientBalanceBefore = await readAddressBalance(recipientAddress, network, loaded.contract);

      const txid = await broadcastAndVerifySpend({
        contract: loaded.contract,
        network,
        signedTransactionHex,
        fundingTxid: loaded.escrow.fundingTxid,
        recipientAddress,
        expectedPayoutSats: payout,
        recipientBalanceBefore
      });

      const escrow = await escrowsRepo.finalizeEscrow({
        escrowId: loaded.escrow.id,
        outcome: rule.finalStatus === "refunded" ? "refund" : "release",
        releaseTxid: txid
      });
      reply.send(escrow);
    } catch (err) {
      app.log.error(err);
      reply.status(422).send({ error: (err as Error).message });
    }
  });
}
