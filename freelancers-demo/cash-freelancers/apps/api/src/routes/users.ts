import type { FastifyInstance } from "fastify";
import type { ActiveRole, UserRole } from "@cash-freelancers/shared";
import { usersRepo } from "../db/repositories/index.js";
import { requireAuth } from "../auth/session.js";
import { decodeAddressForNetwork } from "../utils/address.js";
import { redeemChallenge, ChallengeError } from "../auth/challenge.js";

interface CreateUserBody {
  displayName: string;
  walletAddress?: string;
  roles?: UserRole[];
}

/** Roles a wallet can hold. `client` and `freelancer` are what anyone is —
 *  they are capabilities, not privileges — so the only role worth granting
 *  here is `arbiter`, which is what the arbiter-profile route is for. */
const SELF_GRANTABLE_ROLES: readonly UserRole[] = ["arbiter"];

export async function userRoutes(app: FastifyInstance) {
  // This used to take `walletAddress` and `roles` straight from the body with
  // no authentication, which was an account-takeover vector rather than just a
  // missing check: users are identified by wallet, and /auth/verify creates the
  // row on first sign-in. An attacker could pre-create a row for a victim's
  // address with roles: ["arbiter"], and the victim would then be handed that
  // row when they signed in. The wallet address is now always the
  // authenticated one, and roles can only be self-granted from the small
  // allowlist above.
  app.post<{ Body: CreateUserBody }>("/users", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const caller = await usersRepo.findUserById(request.authenticatedUserId!);
      if (!caller) {
        reply.status(401).send({ error: "Authenticated user no longer exists" });
        return;
      }

      const walletAddress = caller.walletAddress;
      if (request.body.walletAddress && request.body.walletAddress !== walletAddress) {
        return reply.status(403).send({
          error: "walletAddress must be the authenticated wallet"
        });
      }
      // Validated for the same reason any stored address is: a mainnet
      // address on a Chipnet deployment can never sign for anything here.
      decodeAddressForNetwork(walletAddress);

      const requested = request.body.roles ?? [];
      const rejected = requested.filter((r) => !SELF_GRANTABLE_ROLES.includes(r));
      if (rejected.length > 0) {
        return reply.status(400).send({
          error: `Roles cannot be granted here: ${rejected.join(", ")}. Only ${SELF_GRANTABLE_ROLES.join(", ")} can be self-assigned.`
        });
      }

      const roles = [...new Set([...caller.roles, ...requested])];
      const user = await usersRepo.updateUserProfile({
        userId: caller.id,
        displayName: request.body.displayName ?? caller.displayName,
        roles
      });
      reply.status(200).send(user);
    } catch (err) {
      app.log.error(err);
      reply.status(422).send({ error: (err as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>("/users/:id", async (request, reply) => {
    const user = await usersRepo.findUserById(request.params.id);
    if (!user) {
      reply.status(404).send({ error: "User not found" });
      return;
    }
    reply.send(user);
  });

  /*
   * The routes below all act on /users/me rather than /users/:id. That is a
   * deliberate change from the RepID route above, which compares the path
   * parameter against the session. Once an account has more than one wallet,
   * "the authenticated user" is no longer the same thing as "this wallet", and
   * the one thing that is unambiguously the caller is the session itself.
   */

  app.get("/users/me/wallets", { preHandler: requireAuth }, async (request, reply) => {
    const user = await usersRepo.findUserById(request.authenticatedUserId!);
    reply.send(user?.wallets ?? []);
  });

  /**
   * Attaches a second wallet to the caller's account.
   *
   * A signature from the wallet being attached is required, and that is the
   * whole point. Without it, a stolen session token would be enough to bind
   * somebody else's address to this account — and since a linked wallet is a
   * way to prove ownership, an attacker who could add their own would not be
   * adding a convenience, they would be adding themselves as the fallback.
   *
   * Redeemed for "link-wallet", so a signature the user gave for signing in
   * cannot be reused here.
   */
  app.post<{ Body: { challengeId: string; signature: string; label?: string } }>(
    "/users/me/wallets",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const address = await redeemChallenge(
          request.body?.challengeId,
          request.body?.signature,
          "link-wallet"
        );
        reply.status(201).send(await usersRepo.linkWallet(request.authenticatedUserId!, address, request.body?.label));
      } catch (err) {
        const status = err instanceof ChallengeError ? err.status : 422;
        reply.status(status).send({ error: (err as Error).message });
      }
    }
  );

  /**
   * Chooses which linked wallet is active.
   *
   * Only affects new activity. Escrows keep the addresses frozen at creation, so
   * an escrow in flight is unaffected in either direction: a user can move to a
   * new wallet without stranding funds already committed to the old one, which
   * is the reason the old address is kept in the first place.
   *
   * Deliberately does not require a fresh signature. The wallet is already
   * linked, and a proof requirement here would add a wallet prompt to a purely
   * local preference; what it must not do is let the caller set the active
   * wallet to one that isn't theirs, which setActiveWallet enforces.
   */
  app.post<{ Body: { address: string } }>(
    "/users/me/active-wallet",
    { preHandler: requireAuth },
    async (request, reply) => {
      const address = request.body?.address;
      if (!address) {
        reply.status(400).send({ error: "address is required" });
        return;
      }
      try {
        reply.send(await usersRepo.setActiveWallet(request.authenticatedUserId!, address));
      } catch (err) {
        reply.status(422).send({ error: (err as Error).message });
      }
    }
  );

  /**
   * Records which side of the marketplace the user is working on.
   *
   * A stated preference, not a permission. Every route that depends on being a
   * client or a freelancer checks the role the user actually holds *in the
   * resource in question* — see auth/escrow-access.ts and the job/proposal
   * guards — so switching this cannot unlock anything. It exists so the UI can
   * show one dashboard instead of two, and it is stored rather than kept in
   * localStorage so it survives signing in from another device.
   */
  app.post<{ Body: { activeRole: ActiveRole } }>(
    "/users/me/active-role",
    { preHandler: requireAuth },
    async (request, reply) => {
      const activeRole = request.body?.activeRole;
      if (activeRole !== "client" && activeRole !== "freelancer") {
        reply.status(400).send({ error: "activeRole must be 'client' or 'freelancer'" });
        return;
      }
      reply.send(await usersRepo.setActiveRole(request.authenticatedUserId!, activeRole));
    }
  );

  // Linking a RepID proves nothing on its own, so anyone could have claimed a
  // victim's identity this way. Restricted to the caller's own account.
  app.post<{ Params: { id: string }; Body: { repIdAddress: string } }>(
    "/users/:id/repid",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.params.id !== request.authenticatedUserId) {
        reply.status(403).send({ error: "You can only link a RepID to your own account" });
        return;
      }
      const repIdAddress = request.body.repIdAddress?.trim();
      if (!repIdAddress) {
        reply.status(400).send({ error: "repIdAddress is required" });
        return;
      }
      // A RepID identity is a cashaddress, same as a wallet address, so it
      // gets the same network check.
      decodeAddressForNetwork(repIdAddress);
      await usersRepo.linkRepId(request.params.id, repIdAddress);
      reply.status(204).send();
    }
  );
}
