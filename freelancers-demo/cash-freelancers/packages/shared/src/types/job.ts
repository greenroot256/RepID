import type { EscrowMode } from "./escrow.js";

export type JobStatus =
  | "open"
  | "in_progress"
  | "delivered"
  | "completed"
  | "cancelled";

/**
 * Free-form marketplace category. Kept as a string rather than a Postgres enum
 * so new categories do not require a migration; the API only accepts values
 * from {@link JOB_CATEGORIES}.
 */
export type JobCategory = string;

/** The categories the job board offers as filters. */
export const JOB_CATEGORIES = [
  "Design",
  "Development",
  "Writing",
  "Marketing"
] as const;

export type KnownJobCategory = (typeof JOB_CATEGORIES)[number];

export function isKnownJobCategory(value: unknown): value is KnownJobCategory {
  return (
    typeof value === "string" &&
    (JOB_CATEGORIES as readonly string[]).includes(value)
  );
}

export interface Job {
  id: string;
  clientId: string;
  title: string;
  description: string;
  budgetSats: number;
  status: JobStatus;
  freelancerId?: string;
  /** Marketplace category for discovery; absent on jobs created before 0004. */
  category?: JobCategory;
  /** Escrow flavour the client asked for; absent on jobs created before 0004. */
  preferredMode?: EscrowMode;
  /**
   * Denormalized for display. Joined from `users` by the list queries because
   * there is no `GET /users` search endpoint to resolve them from.
   */
  clientDisplayName?: string;
  freelancerDisplayName?: string;
  createdAt: string;
  updatedAt: string;
}
