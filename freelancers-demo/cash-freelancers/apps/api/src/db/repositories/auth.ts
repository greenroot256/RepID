import { db } from "../client.js";

/**
 * What a signed challenge authorises. A signature captured for one of these
 * is refused by the routes for the others, so a message the user approved as
 * "link this wallet to my account" cannot be replayed as a sign-in.
 */
export type ChallengePurpose = "sign-in" | "link-wallet" | "activate-wallet";

export const CHALLENGE_PURPOSES: readonly ChallengePurpose[] = [
  "sign-in",
  "link-wallet",
  "activate-wallet"
];

interface ChallengeRow {
  id: string;
  wallet_address: string;
  nonce: string;
  message: string;
  purpose: ChallengePurpose;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

export interface AuthChallenge {
  id: string;
  walletAddress: string;
  nonce: string;
  message: string;
  purpose: ChallengePurpose;
  expiresAt: Date;
  usedAt?: Date;
}

function mapChallenge(row: ChallengeRow): AuthChallenge {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    nonce: row.nonce,
    message: row.message,
    purpose: row.purpose,
    expiresAt: row.expires_at,
    usedAt: row.used_at ?? undefined
  };
}

export async function createChallenge(input: {
  walletAddress: string;
  nonce: string;
  message: string;
  purpose: ChallengePurpose;
  expiresAt: Date;
}): Promise<AuthChallenge> {
  const { rows } = await db.query<ChallengeRow>(
    `INSERT INTO auth_challenges (wallet_address, nonce, message, purpose, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.walletAddress, input.nonce, input.message, input.purpose, input.expiresAt]
  );
  return mapChallenge(rows[0]);
}

export async function findChallengeById(id: string): Promise<AuthChallenge | undefined> {
  const { rows } = await db.query<ChallengeRow>("SELECT * FROM auth_challenges WHERE id = $1", [id]);
  return rows[0] ? mapChallenge(rows[0]) : undefined;
}

export async function markChallengeUsed(id: string): Promise<void> {
  await db.query("UPDATE auth_challenges SET used_at = now() WHERE id = $1", [id]);
}

export async function createSession(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  /** How this session was established: a wallet challenge or a password. */
  authMethod?: "wallet" | "password";
}): Promise<void> {
  await db.query(
    "INSERT INTO sessions (user_id, token_hash, expires_at, auth_method) VALUES ($1, $2, $3, $4)",
    [input.userId, input.tokenHash, input.expiresAt, input.authMethod ?? "wallet"]
  );
}

export async function findSessionByTokenHash(
  tokenHash: string
): Promise<{ userId: string; expiresAt: Date; authMethod: "wallet" | "password" } | undefined> {
  const { rows } = await db.query<{
    user_id: string;
    expires_at: Date;
    auth_method: "wallet" | "password";
  }>("SELECT user_id, expires_at, auth_method FROM sessions WHERE token_hash = $1", [tokenHash]);
  const row = rows[0];
  return row
    ? { userId: row.user_id, expiresAt: row.expires_at, authMethod: row.auth_method }
    : undefined;
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
}
