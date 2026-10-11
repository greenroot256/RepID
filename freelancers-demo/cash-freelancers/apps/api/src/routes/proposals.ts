import type { FastifyInstance } from "fastify";
import { jobsRepo, proposalsRepo } from "../db/repositories/index.js";
import { requireAuth } from "../auth/session.js";
import { assertCanBidAsFreelancer } from "../auth/escrow-access.js";

/**
 * Upper bound on a proposal's free text. The same reasoning as MAX_TITLE_LENGTH
 * in routes/jobs.ts: this is a request-size guard, not a content rule.
 */
const MAX_MESSAGE_LENGTH = 5_000;

interface CreateProposalBody {
  message?: string;
  proposedAmountSats: number;
}

export async function proposalRoutes(app: FastifyInstance) {
  /**
   * Bidding on a job.
   *
   * The two guards here are about the *job's* roles, not the bidder's
   * `activeRole`. That is deliberate: a user is allowed to hold both a client
   * and a freelancer identity at once — most people do — and what makes
   * bidding legitimate is that this particular job has a different client.
   * Checking `activeRole` here would stop people bidding on work while
   * switched to the other mode, which is a preference, not a permission.
   */
  app.post<{ Params: { jobId: string }; Body: CreateProposalBody }>(
    "/jobs/:jobId/proposals",
    { preHandler: requireAuth },
    async (request, reply) => {
      const job = await jobsRepo.findJobById(request.params.jobId);
      if (!job) {
        reply.status(404).send({ error: "Job not found" });
        return;
      }
      if (job.clientId === request.authenticatedUserId) {
        // A client bidding on their own job would be accepting their own bid:
        // the job would get a freelancer who is also its client, and the escrow
        // would be created between the same two parties paying each other.
        // Nothing downstream assumes that cannot happen, so it is refused at
        // the only point where the relationship is still knowable.
        reply.status(403).send({ error: "You cannot bid on your own job" });
        return;
      }
      try {
        assertCanBidAsFreelancer(job);
      } catch (err) {
        reply.status(403).send({ error: (err as Error).message });
        return;
      }

      const { message, proposedAmountSats } = request.body ?? {};
      if (typeof proposedAmountSats !== "number" || !Number.isInteger(proposedAmountSats)) {
        reply.status(400).send({ error: "proposedAmountSats must be a whole number of satoshis" });
        return;
      }
      if (proposedAmountSats <= 0) {
        reply.status(400).send({ error: "proposedAmountSats must be greater than zero" });
        return;
      }
      // Optional, and when present only required to be non-blank — a proposal
      // with no message is a legitimate bid, so there is no minimum here.
      let safeMessage: string | undefined;
      if (message !== undefined && message !== null) {
        if (typeof message !== "string") {
          reply.status(400).send({ error: "message must be text" });
          return;
        }
        safeMessage = message.trim();
        if (safeMessage.length > MAX_MESSAGE_LENGTH) {
          reply.status(400).send({ error: `message must be at most ${MAX_MESSAGE_LENGTH} characters` });
          return;
        }
        if (safeMessage.length === 0) safeMessage = undefined;
      }

      try {
        const proposal = await proposalsRepo.createProposal({
          jobId: request.params.jobId,
          freelancerId: request.authenticatedUserId!,
          proposedAmountSats,
          message: safeMessage
        });
        reply.status(201).send(proposal);
      } catch (err) {
        app.log.error(err);
        reply.status(422).send({ error: (err as Error).message });
      }
    }
  );

  app.get<{ Params: { jobId: string } }>("/jobs/:jobId/proposals", async (request, reply) => {
    const proposals = await proposalsRepo.findProposalsByJob(request.params.jobId);
    reply.send(proposals);
  });

  app.post<{ Params: { id: string } }>(
    "/proposals/:id/accept",
    { preHandler: requireAuth },
    async (request, reply) => {
      const proposal = await proposalsRepo.findProposalById(request.params.id);
      if (!proposal) {
        reply.status(404).send({ error: "Proposal not found" });
        return;
      }
      const job = await jobsRepo.findJobById(proposal.jobId);
      if (!job || job.clientId !== request.authenticatedUserId) {
        reply.status(403).send({ error: "Only this job's client can accept a proposal" });
        return;
      }
      const accepted = await proposalsRepo.acceptProposal(request.params.id);
      reply.send(accepted);
    }
  );

  app.post<{ Params: { id: string } }>(
    "/proposals/:id/reject",
    { preHandler: requireAuth },
    async (request, reply) => {
      const proposal = await proposalsRepo.findProposalById(request.params.id);
      if (!proposal) {
        reply.status(404).send({ error: "Proposal not found" });
        return;
      }
      const job = await jobsRepo.findJobById(proposal.jobId);
      if (!job || job.clientId !== request.authenticatedUserId) {
        reply.status(403).send({ error: "Only this job's client can reject a proposal" });
        return;
      }
      const rejected = await proposalsRepo.updateProposalStatus(request.params.id, "rejected");
      reply.send(rejected);
    }
  );
}
