import type { FastifyInstance } from "fastify";
import { arbiterProfilesRepo, usersRepo } from "../db/repositories/index.js";
import { requireAuth } from "../auth/session.js";

export async function arbiterRoutes(app: FastifyInstance) {
  // Was unauthenticated and unauthenticated-by-id: any caller could create or
  // rewrite the arbitration profile of any user id, including the fee they
  // charge. A user can only manage their own.
  app.post<{ Params: { id: string }; Body: { bio?: string; feeBps: number } }>(
    "/users/:id/arbiter-profile",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        if (request.params.id !== request.authenticatedUserId) {
          reply.status(403).send({ error: "You can only manage your own arbiter profile" });
          return;
        }

        const { feeBps, bio } = request.body;
        if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
          reply.status(400).send({ error: "feeBps must be an integer between 0 and 10000 (basis points)" });
          return;
        }
        if (bio !== undefined && typeof bio !== "string") {
          reply.status(400).send({ error: "bio must be a string" });
          return;
        }

        // Offering arbitration is the caller's own decision, and it also grants
        // the `arbiter` role used elsewhere to authorise escrow co-signing.
        const user = await usersRepo.findUserById(request.authenticatedUserId!);
        if (!user) {
          reply.status(401).send({ error: "Authenticated user no longer exists" });
          return;
        }
        if (!user.roles.includes("arbiter")) {
          await usersRepo.updateUserProfile({
            userId: user.id,
            displayName: user.displayName,
            roles: [...user.roles, "arbiter"]
          });
        }

        const profile = await arbiterProfilesRepo.upsertArbiterProfile({
          userId: request.params.id,
          feeBps,
          bio
        });
        reply.status(201).send(profile);
      } catch (err) {
        app.log.error(err);
        reply.status(422).send({ error: (err as Error).message });
      }
    }
  );

  app.get<{ Params: { id: string } }>("/users/:id/arbiter-profile", async (request, reply) => {
    const profile = await arbiterProfilesRepo.findArbiterProfile(request.params.id);
    if (!profile) {
      reply.status(404).send({ error: "This user has no arbiter profile" });
      return;
    }
    reply.send(profile);
  });

  app.get("/arbiters", async (_request, reply) => {
    const arbiters = await arbiterProfilesRepo.listActiveArbiters();
    reply.send(arbiters);
  });
}
