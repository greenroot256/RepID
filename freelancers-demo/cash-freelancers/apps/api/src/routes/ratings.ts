import type { FastifyInstance } from "fastify";
import { ratingsRepo, jobsRepo } from "../db/repositories/index.js";
import { requireAuth } from "../auth/session.js";

interface CreateRatingBody {
  /** Ignored. The rater is always the authenticated session — see below. */
  rateeId: string;
  score: number;
  comment?: string;
}

export async function ratingRoutes(app: FastifyInstance) {
  // This was the most damaging of the missing-auth routes, because a rating is
  // reputation. It accepted both `raterId` and `rateeId` from the body with no
  // session, so anyone could file a rating as any other user against any job.
  // The rater now comes from the session, and the caller must actually be a
  // party to the job being rated.
  app.post<{ Params: { jobId: string }; Body: CreateRatingBody }>(
    "/jobs/:jobId/ratings",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const job = await jobsRepo.findJobById(request.params.jobId);
        if (!job) {
          reply.status(404).send({ error: "Job not found" });
          return;
        }

        const raterId = request.authenticatedUserId!;
        const { score, rateeId, comment } = request.body;

        if (!Number.isInteger(score) || score < 1 || score > 5) {
          reply.status(400).send({ error: "score must be an integer between 1 and 5" });
          return;
        }
        if (!job.freelancerId) {
          return reply.status(409).send({ error: "This job has no freelancer to rate yet" });
        }

        // The two parties to a job are its client and its freelancer. The
        // arbiter is deliberately not ratable here: their standing comes from
        // disputes they resolve, which is tracked separately.
        const counterparty = raterId === job.clientId ? job.freelancerId : undefined;
        if (!counterparty || rateeId !== counterparty) {
          return reply.status(403).send({
            error: "You can only rate the other party to this job, and only if you are a party to it"
          });
        }

        const rating = await ratingsRepo.createRating({
          jobId: request.params.jobId,
          raterId,
          rateeId,
          score,
          comment
        });
        reply.status(201).send(rating);
      } catch (err) {
        app.log.error(err);
        reply.status(422).send({ error: (err as Error).message });
      }
    }
  );

  // Public read: a user's rating history is meant to be visible so that
  // reputation is actually usable. Only aggregate-shaped rows are exposed
  // here (no rater identity beyond what is already public).
  app.get<{ Params: { id: string } }>("/users/:id/ratings", async (request, reply) => {
    const ratings = await ratingsRepo.findRatingsForUser(request.params.id);
    reply.send(ratings);
  });
}
