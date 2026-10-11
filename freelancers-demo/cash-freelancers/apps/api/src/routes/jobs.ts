import type { FastifyInstance } from "fastify";
import { jobsRepo, usersRepo } from "../db/repositories/index.js";
import { requireAuth } from "../auth/session.js";
import { assertCanPostJobsAsClient } from "../auth/escrow-access.js";
import {
  isKnownJobCategory,
  type EscrowMode,
  type JobStatus
} from "@cash-freelancers/shared";

interface CreateJobBody {
  title: string;
  description: string;
  budgetSats: number;
  category?: string;
  preferredMode?: EscrowMode;
}

/**
 * Upper bounds on free text.
 *
 * These exist to stop a single request storing megabytes, not to enforce a
 * minimum length — see `assertNonEmptyText` for why there is no lower bound.
 * The column is varchar(N) in the schema, so exceeding these is a database
 * error; catching it here turns that into a message a person can act on.
 */
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 5_000;

/** What a job's text must satisfy: present, and not only whitespace. */
function assertNonEmptyText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${field} cannot be empty`);
  }
  return trimmed;
}

const JOB_STATUSES: JobStatus[] = ["open", "in_progress", "delivered", "completed", "cancelled"];

interface ListJobsQuery {
  status?: string;
  category?: string;
  limit?: string;
  offset?: string;
}

/** Parses a query param into a bounded integer, ignoring junk rather than 400ing. */
function parseBoundedInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

export async function jobRoutes(app: FastifyInstance) {
  /**
   * The public job board.
   *
   * Registered before `/jobs/:id` so the literal path wins over the parameter
   * one; Fastify's router would otherwise treat "mine" as a job id and 404.
   */
  app.get<{ Querystring: ListJobsQuery }>("/jobs", async (request, reply) => {
    const { status, category, limit, offset } = request.query;

    if (status !== undefined && !JOB_STATUSES.includes(status as JobStatus)) {
      reply.status(400).send({
        error: `status must be one of: ${JOB_STATUSES.join(", ")}`
      });
      return;
    }
    if (category !== undefined && !isKnownJobCategory(category)) {
      reply.status(400).send({ error: `category "${category}" is not a known category` });
      return;
    }

    const jobs = await jobsRepo.listJobs({
      status: status as JobStatus | undefined,
      category,
      limit: parseBoundedInt(limit, 50, 100),
      offset: parseBoundedInt(offset, 0, 100_000)
    });
    reply.send(jobs);
  });

  /** The caller's own jobs: posted and assigned, for the dashboard. */
  app.get("/jobs/mine", { preHandler: requireAuth }, async (request, reply) => {
    const jobs = await jobsRepo.listJobsForUser(request.authenticatedUserId!);
    reply.send(jobs);
  });

  app.post<{ Body: CreateJobBody }>("/jobs", { preHandler: requireAuth }, async (request, reply) => {
    const { title, description, budgetSats, category, preferredMode } = request.body;

    // The API accepts only known categories. The column is free text so that
    // adding one does not need a migration, which means the write path is the
    // only place the list can be enforced.
    if (category !== undefined && !isKnownJobCategory(category)) {
      reply.status(400).send({
        error: `category must be one of: Design, Development, Writing, Marketing`
      });
      return;
    }
    if (preferredMode !== undefined && preferredMode !== "bilateral" && preferredMode !== "arbitrated") {
      reply.status(400).send({ error: `preferredMode must be "bilateral" or "arbitrated"` });
      return;
    }

    // The client's own wallet is frozen into this job's escrow later, and they
    // are the ones who sign the funding transaction. An account with no wallet
    // could post a job and then be unable to fund it, so it is refused now
    // while there is nothing to lose.
    const caller = await usersRepo.findUserById(request.authenticatedUserId!);
    if (!caller) {
      reply.status(401).send({ error: "Authenticated user no longer exists" });
      return;
    }

    let safeTitle: string;
    let safeDescription: string;
    try {
      assertCanPostJobsAsClient(caller);
      safeTitle = assertNonEmptyText(title, "title");
      safeDescription = assertNonEmptyText(description, "description");
      if (safeTitle.length > MAX_TITLE_LENGTH) {
        throw new Error(`title must be at most ${MAX_TITLE_LENGTH} characters`);
      }
      if (safeDescription.length > MAX_DESCRIPTION_LENGTH) {
        throw new Error(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
      }
    } catch (err) {
      reply.status(400).send({ error: (err as Error).message });
      return;
    }

    try {
      const job = await jobsRepo.createJob({
        title: safeTitle,
        description: safeDescription,
        budgetSats,
        category,
        preferredMode,
        clientId: request.authenticatedUserId!
      });
      reply.status(201).send(job);
    } catch (err) {
      app.log.error(err);
      reply.status(422).send({ error: (err as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>("/jobs/:id", async (request, reply) => {
    const job = await jobsRepo.findJobById(request.params.id);
    if (!job) {
      reply.status(404).send({ error: "Job not found" });
      return;
    }
    reply.send(job);
  });

  app.post<{ Params: { id: string }; Body: { freelancerId: string } }>(
    "/jobs/:id/assign-freelancer",
    { preHandler: requireAuth },
    async (request, reply) => {
      const job = await jobsRepo.findJobById(request.params.id);
      if (!job) {
        reply.status(404).send({ error: "Job not found" });
        return;
      }
      if (job.clientId !== request.authenticatedUserId) {
        reply.status(403).send({ error: "Only this job's client can assign a freelancer" });
        return;
      }
      const freelancerId = request.body?.freelancerId;
      if (!freelancerId) {
        reply.status(400).send({ error: "freelancerId is required" });
        return;
      }
      // The same reason bidding on your own job is refused. Assigning yourself
      // would skip the proposal step entirely and produce an escrow where both
      // parties are the same person — a self-dealing contract that the
      // bilateral covenant would happily accept and pay out on.
      if (freelancerId === request.authenticatedUserId) {
        reply.status(403).send({ error: "You cannot assign yourself to your own job" });
        return;
      }
      // Assigning straight to somebody who never bid on the job is allowed —
      // clients do hire people they found elsewhere — but the target has to
      // actually exist, otherwise the job ends up in a state where nobody can
      // be found to sign its escrow.
      if (!(await usersRepo.findUserById(freelancerId))) {
        reply.status(404).send({ error: "No such freelancer" });
        return;
      }
      const updated = await jobsRepo.assignFreelancer(request.params.id, freelancerId);
      reply.send(updated);
    }
  );
}
