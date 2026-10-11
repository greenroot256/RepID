import { db } from "../client.js";
import type { Proposal, ProposalStatus } from "@cash-freelancers/shared";

interface ProposalRow {
  id: string;
  job_id: string;
  freelancer_id: string;
  message: string | null;
  proposed_amount_sats: string;
  status: ProposalStatus;
  created_at: Date;
}

function mapProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    jobId: row.job_id,
    freelancerId: row.freelancer_id,
    message: row.message ?? undefined,
    proposedAmountSats: Number(row.proposed_amount_sats),
    status: row.status,
    createdAt: row.created_at.toISOString()
  };
}

export async function createProposal(input: {
  jobId: string;
  freelancerId: string;
  message?: string;
  proposedAmountSats: number;
}): Promise<Proposal> {
  const { rows } = await db.query<ProposalRow>(
    `INSERT INTO proposals (job_id, freelancer_id, message, proposed_amount_sats)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.jobId, input.freelancerId, input.message ?? null, input.proposedAmountSats]
  );
  return mapProposal(rows[0]);
}

export async function findProposalsByJob(jobId: string): Promise<Proposal[]> {
  const { rows } = await db.query<ProposalRow>(
    "SELECT * FROM proposals WHERE job_id = $1 ORDER BY created_at ASC",
    [jobId]
  );
  return rows.map(mapProposal);
}

export async function findProposalById(id: string): Promise<Proposal | undefined> {
  const { rows } = await db.query<ProposalRow>("SELECT * FROM proposals WHERE id = $1", [id]);
  return rows[0] ? mapProposal(rows[0]) : undefined;
}

export async function updateProposalStatus(
  id: string,
  status: ProposalStatus
): Promise<Proposal | undefined> {
  const { rows } = await db.query<ProposalRow>(
    "UPDATE proposals SET status = $2 WHERE id = $1 RETURNING *",
    [id, status]
  );
  return rows[0] ? mapProposal(rows[0]) : undefined;
}

/**
 * Accepts a proposal: marks it `accepted`, assigns its freelancer to the
 * job (which also flips the job to `in_progress`), and marks every other
 * proposal on the same job `rejected` — all in one transaction, so a job
 * never ends up with two accepted proposals.
 */
export async function acceptProposal(id: string): Promise<Proposal | undefined> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<ProposalRow>(
      "UPDATE proposals SET status = 'accepted' WHERE id = $1 RETURNING *",
      [id]
    );
    const proposal = rows[0];
    if (!proposal) {
      await client.query("ROLLBACK");
      return undefined;
    }
    await client.query(
      "UPDATE jobs SET freelancer_id = $2, status = 'in_progress', updated_at = now() WHERE id = $1",
      [proposal.job_id, proposal.freelancer_id]
    );
    await client.query(
      "UPDATE proposals SET status = 'rejected' WHERE job_id = $1 AND id != $2",
      [proposal.job_id, id]
    );
    await client.query("COMMIT");
    return mapProposal(proposal);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
