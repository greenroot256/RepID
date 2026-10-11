import type { FastifyInstance } from "fastify";
import { disputesRepo, escrowsRepo, jobsRepo } from "../db/repositories/index.js";
import { requireAuth } from "../auth/session.js";

export async function disputeRoutes(app: FastifyInstance) {
  app.post<{ Params: { escrowId: string }; Body: { reason: string } }>(
    "/escrows/:escrowId/disputes",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const escrow = await escrowsRepo.findEscrowById(request.params.escrowId);
        if (!escrow) {
          reply.status(404).send({ error: "Escrow not found" });
          return;
        }
        const job = await jobsRepo.findJobById(escrow.jobId);
        const isParty =
          job && (job.clientId === request.authenticatedUserId || job.freelancerId === request.authenticatedUserId);
        if (!isParty) {
          reply.status(403).send({ error: "Only this escrow's client or freelancer can open a dispute" });
          return;
        }

        const dispute = await disputesRepo.openDispute({
          escrowId: request.params.escrowId,
          openedBy: request.authenticatedUserId!,
          reason: request.body.reason
        });
        reply.status(201).send(dispute);
      } catch (err) {
        app.log.error(err);
        reply.status(422).send({ error: (err as Error).message });
      }
    }
  );

  app.get<{ Params: { escrowId: string } }>("/escrows/:escrowId/disputes", async (request, reply) => {
    const dispute = await disputesRepo.findDisputeByEscrowId(request.params.escrowId);
    if (!dispute) {
      reply.status(404).send({ error: "No dispute for this escrow" });
      return;
    }
    reply.send(dispute);
  });

  // The arbiter's written ruling. The on-chain side of that ruling
  // (release vs. refund) is separate — see
  // GET /escrows/:id/arbitrated-spend-transaction?outcome=... and the
  // two-step signing routes.
  app.post<{ Params: { id: string }; Body: { resolution: string } }>(
    "/disputes/:id/resolve",
    { preHandler: requireAuth },
    async (request, reply) => {
      const dispute = await disputesRepo.findDisputeById(request.params.id);
      if (!dispute) {
        reply.status(404).send({ error: "Dispute not found" });
        return;
      }
      const escrow = await escrowsRepo.findEscrowById(dispute.escrowId);
      if (!escrow || escrow.arbiterId !== request.authenticatedUserId) {
        reply.status(403).send({ error: "Only this escrow's arbiter can resolve the dispute" });
        return;
      }

      const resolved = await disputesRepo.resolveDispute({
        id: request.params.id,
        resolution: request.body.resolution,
        resolvedBy: request.authenticatedUserId!
      });
      reply.send(resolved);
    }
  );
}
