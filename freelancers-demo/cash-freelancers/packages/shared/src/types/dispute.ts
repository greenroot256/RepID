export type DisputeStatus = "open" | "resolved";

export interface Dispute {
  id: string;
  escrowId: string;
  openedBy: string;
  reason: string;
  status: DisputeStatus;
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
}
