import { db } from "../client.js";
import type { Rating } from "@cash-freelancers/shared";

interface RatingRow {
  id: string;
  job_id: string;
  rater_id: string;
  ratee_id: string;
  score: number;
  comment: string | null;
  repid_synced: boolean;
  created_at: Date;
}

function mapRating(row: RatingRow): Rating {
  return {
    id: row.id,
    jobId: row.job_id,
    raterId: row.rater_id,
    rateeId: row.ratee_id,
    score: row.score,
    comment: row.comment ?? undefined,
    repidSynced: row.repid_synced,
    createdAt: row.created_at.toISOString()
  };
}

export async function createRating(input: {
  jobId: string;
  raterId: string;
  rateeId: string;
  score: number;
  comment?: string;
}): Promise<Rating> {
  const { rows } = await db.query<RatingRow>(
    `INSERT INTO ratings (job_id, rater_id, ratee_id, score, comment)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.jobId, input.raterId, input.rateeId, input.score, input.comment ?? null]
  );
  return mapRating(rows[0]);
}

export async function findRatingsForUser(rateeId: string): Promise<Rating[]> {
  const { rows } = await db.query<RatingRow>(
    "SELECT * FROM ratings WHERE ratee_id = $1 ORDER BY created_at DESC",
    [rateeId]
  );
  return rows.map(mapRating);
}

export async function markRatingRepIdSynced(id: string): Promise<void> {
  await db.query("UPDATE ratings SET repid_synced = true WHERE id = $1", [id]);
}
