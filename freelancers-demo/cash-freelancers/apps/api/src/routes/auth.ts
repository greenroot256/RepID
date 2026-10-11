import type { FastifyInstance } from "fastify";
import { authRepo, usersRepo } from "../db/repositories/index.js";
import { verifyMessage } from "../utils/bch-message.js";
import { generateSessionToken, hashToken, requireAuth, SESSION_TTL_MS } from "../auth/session.js";
import { hashPassword, verifyPassword, passwordNeedsRehash } from "../auth/password.js";
import { consume, reset } from "../auth/rate-limit.js";
import { issueChallenge, redeemChallenge, ChallengeError } from "../auth/challenge.js";
import { normaliseEmail, validateEmail, validateUsername } from "../utils/identity.js";

/**
 * Sign-in attempts allowed per window.
 *
 * Counted per account, not per IP, so one attacker cannot lock a real user out
 * by burning their budget from many addresses. Per-IP limiting is deliberately
 * not layered on: it punishes shared/NAT addresses and, against an attacker
 * rotating IPs, buys almost nothing. This is a single in-process counter, so it
 * constrains casual guessing rather than a determined distributed attack — see
 * auth/rate-limit.ts.
 */
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function authRoutes(app: FastifyInstance) {
  /**
   * Step 1 of a wallet proof: get a one-time message to sign. Signing it proves
   * control of a key; it says nothing on its own about which account that key
   * belongs to.
   *
   * `purpose` defaults to sign-in but callers should always pass it, since it
   * is what the message says the user is approving and what redemption checks.
   */
  app.post<{ Body: { walletAddress: string; purpose?: string } }>(
    "/auth/challenge",
    async (request, reply) => {
      try {
        const { challengeId, message, purpose } = await issueChallenge(
          request.body?.walletAddress,
          request.body?.purpose
        );
        reply.status(201).send({ challengeId, message, purpose });
      } catch (err) {
        const status = err instanceof ChallengeError ? err.status : 400;
        reply.status(status).send({ error: (err as Error).message });
      }
    }
  );

  /**
   * Issues a session and the user it belongs to, after a caller has already
   * established which user it is talking to.
   */
  async function startSession(userId: string, authMethod: "wallet" | "password") {
    const token = generateSessionToken();
    await authRepo.createSession({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      authMethod
    });
    return token;
  }

  /**
   * Step 2: sign in with a wallet.
   *
   * This no longer creates accounts. It used to, which meant a typo or a
   * throwaway wallet silently became a permanent identity, with no moment at
   * which a person chose to have an account. Registration is now explicit
   * (/auth/register) and asks for what an account needs to be recoverable: a
   * username and a password.
   */
  app.post<{ Body: { challengeId: string; signature: string } }>(
    "/auth/verify",
    async (request, reply) => {
      let walletAddress: string;
      try {
        walletAddress = await redeemChallenge(
          request.body?.challengeId,
          request.body?.signature,
          "sign-in"
        );
      } catch (err) {
        const status = err instanceof ChallengeError ? err.status : 422;
        reply.status(status).send({ error: (err as Error).message });
        return;
      }

      const user = await usersRepo.findUserByWalletAddress(walletAddress);
      if (!user) {
        // Distinct from a 401 on purpose: the signature was good, the wallet is
        // simply not attached to an account yet, so the client should offer to
        // create one rather than treating it as a failure.
        reply.status(409).send({
          error: "No account is linked to this wallet yet",
          registerable: true,
          walletAddress
        });
        return;
      }

      const limit = consume("verify", walletAddress, LOGIN_LIMIT, LOGIN_WINDOW_MS);
      if (!limit.allowed) {
        reply.status(429).send({
          error: "Too many sign-in attempts. Try again later.",
          retryAfterSeconds: limit.retryAfterSeconds
        });
        return;
      }
      reset("verify", walletAddress);

      const token = await startSession(user.id, "wallet");
      await usersRepo.touchWalletLastUsed(walletAddress);
      reply.send({ token, user });
    }
  );

  /**
   * Creates an account, proving control of the wallet that will be linked to it.
   *
   * A password is required, and that is the load-bearing decision: the reason an
   * account survives losing its wallet is having a second way back in. An
   * account created without one has exactly as many recovery routes as it has
   * wallets.
   */
  app.post<{
    Body: { challengeId: string; signature: string; username: string; email: string; password: string };
  }>("/auth/register", async (request, reply) => {
    const { challengeId, signature, username, email, password } = request.body ?? {};

    let walletAddress: string;
    try {
      walletAddress = await redeemChallenge(challengeId, signature, "sign-in");
    } catch (err) {
      const status = err instanceof ChallengeError ? err.status : 422;
      reply.status(status).send({ error: (err as Error).message });
      return;
    }

    /*
     * The challenge is already spent at this point, so a validation failure
     * from here on would leave the user unable to retry without a fresh
     * signature — an extra wallet prompt to fix a typo'd email. Everything
     * checkable without the signature is therefore checked first, and the
     * challenge is treated as the last thing consumed.
     */
    let normalizedEmail: string;
    let safeUsername: string;
    let passwordHash: string;
    try {
      normalizedEmail = normaliseEmail(email);
      validateEmail(normalizedEmail);
      safeUsername = validateUsername(username);
      // Advisory only: two concurrent registrations can both pass this and only
      // one can win the unique index, so the conflict below is handled too.
      if (!(await usersRepo.isUsernameAvailable(safeUsername))) {
        throw new Error("That username is already taken");
      }
      if (!(await usersRepo.isEmailAvailable(normalizedEmail))) {
        throw new Error("That email is already registered");
      }
      passwordHash = await hashPassword(password);
    } catch (err) {
      reply.status(400).send({ error: (err as Error).message });
      return;
    }

    if (await usersRepo.findUserByWalletAddress(walletAddress)) {
      // Reachable when the wallet got linked between the signature and this
      // request landing.
      reply.status(409).send({ error: "That wallet is already linked to an account" });
      return;
    }

    let user;
    try {
      user = await usersRepo.createUser({
        // The public handle doubles as the default display name until the user
        // picks something else; the two are separate fields, and only the
        // handle is unique.
        displayName: safeUsername,
        walletAddress,
        roles: [],
        username: safeUsername,
        email: normalizedEmail,
        passwordHash
      });
    } catch (err) {
      const message = (err as Error).message;
      const conflict =
        message.includes("users_email_key") ||
        message.includes("users_username_key") ||
        message.includes("idx_users_email") ||
        message.includes("idx_users_username");
      reply.status(conflict ? 409 : 422).send({
        error: conflict ? "That email or username is already taken" : message
      });
      return;
    }

    const token = await startSession(user.id, "wallet");
    reply.status(201).send({ token, user });
  });

  /**
   * Sign in with email and password, no wallet needed.
   *
   * This is the point of having an account that is not the wallet: browsing,
   * posting and bidding all work from here. It grants nothing that needs a
   * key — signing escrow transactions still requires the wallet, and the
   * session records which of the two it was so those routes can say so.
   */
  app.post<{ Body: { email: string; password: string } }>(
    "/auth/login",
    async (request, reply) => {
      const { email, password } = request.body ?? {};
      if (typeof email !== "string" || typeof password !== "string") {
        reply.status(400).send({ error: "email and password are required" });
        return;
      }

      // Keyed on the submitted email, not the resolved account, so the budget is
      // consumed whether or not the account exists. Otherwise an attacker could
      // probe addresses for free, and the "no such user" vs "wrong password"
      // distinction would become a rate-limit oracle.
      const key = email.trim().toLowerCase();
      const limit = consume("login", key, LOGIN_LIMIT, LOGIN_WINDOW_MS);
      if (!limit.allowed) {
        reply.status(429).send({
          error: "Too many attempts. Try again later.",
          retryAfterSeconds: limit.retryAfterSeconds
        });
        return;
      }

      const user = await usersRepo.findUserByEmail(key);
      const stored = user ? await usersRepo.findPasswordHashByUserId(user.id) : null;
      const ok = await verifyPassword(password, stored);
      if (!user || !ok || !stored) {
        // One message for every failure mode — unknown email, account without a
        // password, wrong password — so the response cannot be used to discover
        // which addresses are registered.
        reply.status(401).send({ error: "Email or password is not correct" });
        return;
      }
      reset("login", key);

      // Fold in a cost increase the user has not paid for yet. Doing it on the
      // one request that already proved the password means a parameter bump
      // never needs a forced reset that nobody completes.
      if (await passwordNeedsRehash(stored)) {
        await usersRepo.setPasswordHash(user.id, await hashPassword(password));
      }

      const token = await startSession(user.id, "password");
      reply.send({ token, user });
    }
  );

  /**
   * Sets or changes the password.
   *
   * The two cases differ and the difference is the security property: an account
   * that already has one must present the current password, so a stolen session
   * cannot lock the real owner out permanently. An account without one is
   * setting it for the first time, is already authenticated by wallet, and has
   * no current password to check against.
   */
  app.post<{ Body: { currentPassword?: string; newPassword: string } }>(
    "/auth/password",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body ?? {};
      const userId = request.authenticatedUserId!;

      const stored = await usersRepo.findPasswordHashByUserId(userId);
      if (stored) {
        if (!currentPassword || !(await verifyPassword(currentPassword, stored))) {
          reply.status(403).send({ error: "Your current password is not correct" });
          return;
        }
      }

      let passwordHash: string;
      try {
        passwordHash = await hashPassword(newPassword);
      } catch (err) {
        reply.status(400).send({ error: (err as Error).message });
        return;
      }

      reply.send({ user: await usersRepo.setPasswordHash(userId, passwordHash) });
    }
  );

  app.post("/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    await authRepo.deleteSession(request.sessionTokenHash!);
    reply.status(204).send();
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    reply.send(await usersRepo.findUserById(request.authenticatedUserId!));
  });
}
