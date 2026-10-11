import { db } from "../client.js";
import type {
  EscrowMode,
  Job,
  JobCategory,
  JobStatus
} from "@cash-freelancers/shared";

interface JobRow {
  id: string;
  client_id: string;
  freelancer_id: string | null;
  title: string;
  description: string;
  budget_sats: string; // bigint comes back as string from pg
  status: JobStatus;
  category: string | null;
  preferred_mode: EscrowMode | null;
  client_display_name?: string | null;
  freelancer_display_name?: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    clientId: row.client_id,
    freelancerId: row.freelancer_id ?? undefined,
    title: row.title,
    description: row.description,
    budgetSats: Number(row.budget_sats),
    status: row.status,
    category: row.category ?? undefined,
    preferredMode: row.preferred_mode ?? undefined,
    clientDisplayName: row.client_display_name ?? undefined,
    freelancerDisplayName: row.freelancer_display_name ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

/**
 * The joined `users` aliases used by every list query. Kept in one constant so
 * a column rename breaks one place rather than five.
 */
const WITH_PARTY_NAMES = `
  SELECT j.*,
         c.display_name AS client_display_name,
         f.display_name AS freelancer_display_name
    FROM jobs j
    JOIN users c ON c.id = j.client_id
    LEFT JOIN users f ON f.id = j.freelancer_id
`;

export async function createJob(input: {
  clientId: string;
  title: string;
  description: string;
  budgetSats: number;
  category?: string;
  preferredMode?: EscrowMode;
}): Promise<Job> {
  const { rows } = await db.query<JobRow>(
    `INSERT INTO jobs (client_id, title, description, budget_sats, category, preferred_mode)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      input.clientId,
      input.title,
      input.description,
      input.budgetSats,
      input.category ?? null,
      input.preferredMode ?? null
    ]
  );
  return mapJob(rows[0]);
}

export async function findJobById(id: string): Promise<Job | undefined> {
  const { rows } = await db.query<JobRow>(`${WITH_PARTY_NAMES} WHERE j.id = $1`, [id]);
  return rows[0] ? mapJob(rows[0]) : undefined;
}

export interface ListJobsFilters {
  status?: JobStatus;
  category?: JobCategory;
  /** Excludes a job from its own client's board view. */
  excludeClientId?: string;
  limit?: number;
  offset?: number;
}

/** Hard ceiling so a single request cannot ask for the whole table. */
const MAX_LIMIT = 100;

/**
 * The public job board's only query. Filters are applied with a parameterised
 * `($n IS NULL OR col = $n)` pattern rather than by building SQL strings, so
 * every filter stays an index-friendly, injection-safe comparison.
 */
export async function listJobs(filters: ListJobsFilters = {}): Promise<Job[]> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), MAX_LIMIT);
  const offset = Math.max(filters.offset ?? 0, 0);

  const { rows } = await db.query<JobRow>(
    `${WITH_PARTY_NAMES}
      WHERE ($1::job_status IS NULL OR j.status = $1)
        AND ($2::text IS NULL OR j.category = $2)
        AND ($3::uuid IS NULL OR j.client_id <> $3)
      ORDER BY j.created_at DESC
      LIMIT $4 OFFSET $5`,
    [filters.status ?? null, filters.category ?? null, filters.excludeClientId ?? null, limit, offset]
  );
  return rows.map(mapJob);
}

/**
 * Every job the user is on either side of: the ones they posted plus the ones
 * they were assigned. Powers the dashboard's "my work" tabs.
 */
export async function listJobsForUser(userId: string): Promise<Job[]> {
  const { rows } = await db.query<JobRow>(
    `${WITH_PARTY_NAMES}
      WHERE j.client_id = $1 OR j.freelancer_id = $1
      ORDER BY j.updated_at DESC`,
    [userId]
  );
  return rows.map(mapJob);
}

export async function assignFreelancer(jobId: string, freelancerId: string): Promise<Job | undefined> {
  const { rows } = await db.query<JobRow>(
    `UPDATE jobs SET freelancer_id = $2, status = 'in_progress', updated_at = now()
     WHERE id = $1 RETURNING *`,
    [jobId, freelancerId]
  );
  return rows[0] ? mapJob(rows[0]) : undefined;
}

export async function updateJobStatus(jobId: string, status: JobStatus): Promise<Job | undefined> {
  const { rows } = await db.query<JobRow>(
    `UPDATE jobs SET status = $2, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [jobId, status]
  );
  return rows[0] ? mapJob(rows[0]) : undefined;
}
