export type ProposalStatus = "sent" | "accepted" | "rejected";

export interface Proposal {
  id: string;
  jobId: string;
  freelancerId: string;
  message?: string;
  proposedAmountSats: number;
  status: ProposalStatus;
  createdAt: string;
}
