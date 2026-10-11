import { db } from "../client.js";
import type { ArbiterProfile } from "@cash-freelancers/shared";

interface ArbiterProfileRow {
  user_id: string;
  bio: string | null;
  fee_bps: number;
  active: boolean;
  disputes_resolved: number;
  created_at: Date;
}

function mapArbiterProfile(row: ArbiterProfileRow): ArbiterProfile {
  return {
    userId: row.user_id,
    bio: row.bio ?? undefined,
    feeBps: row.fee_bps,
    active: row.active,
    disputesResolved: row.disputes_resolved,
    createdAt: row.created_at.toISOString()
  };
}

export async function upsertArbiterProfile(input: {
  userId: string;
  bio?: string;
  feeBps: number;
}): Promise<ArbiterProfile> {
  const { rows } = await db.query<ArbiterProfileRow>(
    `INSERT INTO arbiter_profiles (user_id, bio, fee_bps)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET bio = EXCLUDED.bio, fee_bps = EXCLUDED.fee_bps
     RETURNING *`,
    [input.userId, input.bio ?? null, input.feeBps]
  );
  return mapArbiterProfile(rows[0]);
}

export async function findArbiterProfile(userId: string): Promise<ArbiterProfile | undefined> {
  const { rows } = await db.query<ArbiterProfileRow>(
    "SELECT * FROM arbiter_profiles WHERE user_id = $1",
    [userId]
  );
  return rows[0] ? mapArbiterProfile(rows[0]) : undefined;
}

export async function listActiveArbiters(): Promise<ArbiterProfile[]> {
  const { rows } = await db.query<ArbiterProfileRow>(
    "SELECT * FROM arbiter_profiles WHERE active = true ORDER BY disputes_resolved DESC"
  );
  return rows.map(mapArbiterProfile);
}
