import { db } from "../client.js";
import type { Dispute, DisputeStatus } from "@cash-freelancers/shared";

interface DisputeRow {
  id: string;
  escrow_id: string;
  opened_by: string;
  reason: string;
  status: DisputeStatus;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
}

function mapDispute(row: DisputeRow): Dispute {
  return {
    id: row.id,
    escrowId: row.escrow_id,
    openedBy: row.opened_by,
    reason: row.reason,
    status: row.status,
    resolution: row.resolution ?? undefined,
    resolvedBy: row.resolved_by ?? undefined,
    resolvedAt: row.resolved_at?.toISOString(),
    createdAt: row.created_at.toISOString()
  };
}

export async function openDispute(input: {
  escrowId: string;
  openedBy: string;
  reason: string;
}): Promise<Dispute> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<DisputeRow>(
      `INSERT INTO disputes (escrow_id, opened_by, reason) VALUES ($1, $2, $3) RETURNING *`,
      [input.escrowId, input.openedBy, input.reason]
    );
    await client.query("UPDATE escrows SET status = 'disputed', updated_at = now() WHERE id = $1", [
      input.escrowId
    ]);
    await client.query("COMMIT");
    return mapDispute(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function findDisputeByEscrowId(escrowId: string): Promise<Dispute | undefined> {
  const { rows } = await db.query<DisputeRow>(
    "SELECT * FROM disputes WHERE escrow_id = $1 ORDER BY created_at DESC LIMIT 1",
    [escrowId]
  );
  return rows[0] ? mapDispute(rows[0]) : undefined;
}

export async function findDisputeById(id: string): Promise<Dispute | undefined> {
  const { rows } = await db.query<DisputeRow>("SELECT * FROM disputes WHERE id = $1", [id]);
  return rows[0] ? mapDispute(rows[0]) : undefined;
}

export async function resolveDispute(input: {
  id: string;
  resolution: string;
  resolvedBy: string;
}): Promise<Dispute | undefined> {
  const { rows } = await db.query<DisputeRow>(
    `UPDATE disputes
     SET status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now()
     WHERE id = $1 RETURNING *`,
    [input.id, input.resolution, input.resolvedBy]
  );
  return rows[0] ? mapDispute(rows[0]) : undefined;
}
