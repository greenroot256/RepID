export interface Rating {
  id: string;
  jobId: string;
  raterId: string;
  rateeId: string;
  score: number; // 1 to 5
  comment?: string;
  repidSynced: boolean;
  createdAt: string;
}
