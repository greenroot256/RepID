"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Spinner, Pill } from "./ui";

interface ReputationResponse {
  address: string;
  score: string;
  totalRatings: number;
  verified: boolean;
}

export function ReputationBadge({ address }: { address: string }) {
  const [data, setData] = useState<ReputationResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchReputation() {
      try {
        const result = await api.get<ReputationResponse>(`/reputation/${address}`);
        setData(result);
      } catch (err) {
        console.error("Failed to fetch reputation", err);
      } finally {
        setLoading(false);
      }
    }
    fetchReputation();
  }, [address]);

  if (loading) return <Spinner />;

  if (!data) return <Pill>Reputation unavailable</Pill>;

  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "12px" }}>
      <Pill>
        RepID Score: {data.score} / 5.0
      </Pill>
      <span style={{ fontSize: "12px", color: "var(--muted)" }}>
        ({data.totalRatings} ratings)
      </span>
      {data.verified && (
        <span style={{ fontSize: "12px", color: "var(--primary)" }}>✓ Verified</span>
      )}
    </div>
  );
}
