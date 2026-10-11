import type { FastifyReply, FastifyRequest } from "fastify";
import { escrowsRepo, jobsRepo } from "../db/repositories/index.js";
import { requireAuth } from "./session.js";

/**
 * The parties of an escrow, resolved from the job it belongs to. Kept
 * deliberately separate from `loadEscrowContract` in routes/escrows.ts: that
 * one also instantiates a CashScript contract, which needs a network provider
 * and compiles the artifact. An authorization check must not depend on any of
 * that — otherwise a provider hiccup would turn into a 500 on a request that
 * only needed a permission decision.
 */
export interface EscrowParties {
  escrowId: string;
  clientId: string;
  freelancerId: string;
  arbiterId: string | undefined;
  status: string;
  mode: "bilateral" | "arbitrated";
  /**
   * The addresses the escrow is locked to, in a stable order. Read from the
   * escrow row rather than from the accounts, because these are the addresses
   * whose keys can sign for it — a party that later activates a different
   * wallet is still bound here to the one the escrow was created with.
   */
  walletAddresses: string[];
}

export async function resolveEscrowParties(escrowId: string): Promise<EscrowParties | undefined> {
  const escrow = await escrowsRepo.findEscrowById(escrowId);
  if (!escrow) return undefined;

  const job = await jobsRepo.findJobById(escrow.jobId);
  if (!job || !job.freelancerId) return undefined;

  return {
    escrowId: escrow.id,
    clientId: job.clientId,
    freelancerId: job.freelancerId,
    arbiterId: escrow.arbiterId,
    status: escrow.status,
    mode: escrow.mode,
    walletAddresses: [escrow.clientWalletAddress, escrow.freelancerWalletAddress, escrow.arbiterWalletAddress].filter(
      (address): address is string => typeof address === "string"
    )
  };
}

/** The three wallet addresses that are party to an escrow, in a stable order. */
export async function resolveEscrowWalletAddresses(escrowId: string): Promise<string[] | undefined> {
  const parties = await resolveEscrowParties(escrowId);
  return parties?.walletAddresses;
}
/**
 * Requires a valid session *and* that the caller is a party to this escrow.
 *
 * Requiring only authentication is not enough for these routes: the escrow
 * signing endpoints hand out transactions that move the client's money and
 * write state to the escrow record, so "any logged-in user" is not a
 * permission. Authentication answers *who*; this answers *whether they may
 * touch this specific escrow*.
 *
 * Replies 401 when unauthenticated and 403 when authenticated but not a party,
 * then returns undefined so the caller can `return` the reply.
 */
export async function requireEscrowParty(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<EscrowParties | undefined> {
  await requireAuth(request, reply);
  if (reply.sent) return undefined;

  const escrowId = request.params.id;
  const parties = await resolveEscrowParties(escrowId);
  if (!parties) {
    reply.status(404).send({ error: "Escrow not found" });
    return undefined;
  }

  const caller = request.authenticatedUserId!;
  const isParty = [parties.clientId, parties.freelancerId, parties.arbiterId].includes(caller);
  if (!isParty) {
    reply.status(403).send({ error: "You are not a party to this escrow" });
    return undefined;
  }

  return parties;
}

/**
 * Same check, but narrower: only the escrow's client may fund it, and only the
 * freelancer may reclaim it. The client funds because the money is theirs to
 * lock up; the freelancer is the only party the bilateral covenant will accept
 * a `reclaim` signature from.
 */
export async function requireEscrowClient(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<EscrowParties | undefined> {
  const parties = await requireEscrowParty(request, reply);
  if (!parties) return undefined;

  if (parties.clientId !== request.authenticatedUserId) {
    reply.status(403).send({ error: "Only this escrow's client can perform this action" });
    return undefined;
  }
  return parties;
}

export async function requireEscrowFreelancer(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<EscrowParties | undefined> {
  const parties = await requireEscrowParty(request, reply);
  if (!parties) return undefined;

  if (parties.freelancerId !== request.authenticatedUserId) {
    reply.status(403).send({ error: "Only this escrow's freelancer can perform this action" });
    return undefined;
  }
  return parties;
}

/**
 * Whether a job is still open to new proposals.
 *
 * A throw rather than a boolean because every caller wants to answer with the
 * reason, and the reason depends on which of these it is. Throwing also keeps
 * the check from being skipped by a caller that forgot to look at a return
 * value — a `false` that is ignored fails open, an uncaught throw does not.
 */
export function assertCanBidAsFreelancer(job: { status: string; freelancerId?: string }): void {
  if (job.freelancerId) {
    // Someone has already been hired. Accepting a second proposal now would
    // leave two "chosen" freelancers for one job, and the client would be able
    // to accept whichever they liked after both had done the work.
    throw new Error("This job already has a freelancer and is not accepting proposals");
  }
  if (job.status !== "open") {
    throw new Error(`This job is ${job.status} and is not accepting proposals`);
  }
}

/**
 * Whether the caller may post a job as a client.
 *
 * Anyone may hire, so the only real question is whether the account has reached
 * the point of existing at all — an `activeRole` of "freelancer" is a display
 * preference and is not consulted here. What the route does enforce is that the
 * caller has a wallet, because a job's client is later frozen into an escrow
 * that its client has to sign for.
 */
export function assertCanPostJobsAsClient(user: { wallets?: { active: boolean }[] }): void {
  if (!user.wallets?.some((wallet) => wallet.active)) {
    throw new Error("Link a wallet before posting a job — an escrow is signed by the client's wallet");
  }
}
