export interface ArbiterProfile {
  userId: string;
  bio?: string;
  feeBps: number; // arbiter's fee, in basis points
  active: boolean;
  disputesResolved: number;
  createdAt: string;
}
