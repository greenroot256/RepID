import { randomBytes, createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { authRepo } from "../db/repositories/index.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireAuth` once the session token has been verified. */
    authenticatedUserId?: string;
    /** Set by `requireAuth` — the sha256 of the presented token, handy
     *  for routes (like logout) that need to act on this exact session
     *  without re-parsing the header. */
    sessionTokenHash?: string;
    /**
     * How this session was established. A session opened with a password is a
     * perfectly good session for browsing, posting and bidding, but it is not
     * proof that a *key* is available, so routes that hand out transactions to
     * be signed can tell the two apart and tell the client a wallet is needed.
     */
    sessionAuthMethod?: "wallet" | "password";
  }
}

const TOKEN_BYTES = 32;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Fastify preHandler: requires a valid `Authorization: Bearer <token>`
 * header. A token exists because its holder proved control of an account —
 * either by signing a challenge with a linked wallet (see /auth/challenge and
 * /auth/verify) or with a password (see /auth/login). The two are recorded
 * apart in the session row because a password session is not proof that a
 * signing key is reachable.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) {
    reply.status(401).send({ error: "Missing Authorization: Bearer <token> header" });
    return;
  }

  const tokenHash = hashToken(token);
  const session = await authRepo.findSessionByTokenHash(tokenHash);
  if (!session || session.expiresAt.getTime() < Date.now()) {
    reply.status(401).send({ error: "Invalid or expired session" });
    return;
  }

  request.authenticatedUserId = session.userId;
  request.sessionTokenHash = tokenHash;
  request.sessionAuthMethod = session.authMethod;
}
