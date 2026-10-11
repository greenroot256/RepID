"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { EscrowSummary, Job } from "@cash-freelancers/shared";
import { api } from "../../lib/api";
import {
  formatBch,
  relativeTime,
  ESCROW_STATUS_LABEL,
  ESCROW_MODE_LABEL,
  jobStatusTone,
  escrowStatusTone
} from "../../lib/format";
import { useAuth } from "../providers/AuthProvider";
import { EmptyState, Notice, Pill, Spinner } from "../components/ui";

type Tab = "escrows" | "posted" | "assigned";

/**
 * The dashboard is a client component rather than a Server Component because
 * everything on it is per-user: the session lives in localStorage, so the two
 * listing endpoints are called from the browser.
 */
export function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("escrows");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [escrows, setEscrows] = useState<EscrowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [myJobs, myEscrows] = await Promise.all([
        api.get<Job[]>("/jobs/mine"),
        api.get<EscrowSummary[]>("/escrows/mine")
      ]);
      setJobs(myJobs);
      setEscrows(myEscrows);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
  }, [user, load]);

  if (authLoading || (loading && user)) return <Spinner label="Loading your work…" />;

  if (!user) {
    return (
      <Notice>
        Sign in to see your jobs and escrows.{" "}
        <Link href="/jobs" style={{ color: "var(--primary)" }}>
          Browse work
        </Link>{" "}
        instead.
      </Notice>
    );
  }

  if (error) {
    return <Notice tone="danger">{error}</Notice>;
  }

  const posted = jobs.filter((j) => j.clientId === user.id);
  const assigned = jobs.filter((j) => j.freelancerId === user.id);

  return (
    <>
      <div className="filters">
        {(
          [
            ["escrows", `Escrows (${escrows.length})`],
            ["posted", `Posted (${posted.length})`],
            ["assigned", `Doing (${assigned.length})`]
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? "filter active" : "filter"}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "escrows" && <EscrowList escrows={escrows} />}
      {tab === "posted" && <JobList jobs={posted} empty="You have not posted a job yet" />}
      {tab === "assigned" && <JobList jobs={assigned} empty="No work assigned to you yet" />}
    </>
  );
}

function EscrowList({ escrows }: { escrows: EscrowSummary[] }) {
  if (escrows.length === 0) {
    return (
      <EmptyState title="No escrows yet">
        <p>An escrow appears here once you fund one, or take a job that has one.</p>
      </EmptyState>
    );
  }

  return (
    <div className="dash-card">
      {escrows.map((escrow) => (
        <Link key={escrow.id} href={`/escrows/${escrow.id}`} className="dash-row">
          <div>
            <p className="title">{escrow.jobTitle}</p>
            <p className="sub">
              {ESCROW_MODE_LABEL[escrow.mode]} · as {escrow.viewerRole}
            </p>
          </div>
          <div className="dash-amount">
            <p>{formatBch(escrow.amountSats)}</p>
            <Pill tone={escrowStatusTone(escrow.status)}>{ESCROW_STATUS_LABEL[escrow.status]}</Pill>
          </div>
        </Link>
      ))}
    </div>
  );
}

function JobList({ jobs, empty }: { jobs: Job[]; empty: string }) {
  if (jobs.length === 0) {
    return (
      <EmptyState title={empty}>
        <p style={{ marginTop: 8 }}>
          <Link href="/jobs" className="btn btn-line btn-sm">
            Explore work
          </Link>
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="dash-card">
      {jobs.map((job) => (
        <Link key={job.id} href={`/jobs/${job.id}`} className="dash-row">
          <div>
            <p className="title">{job.title}</p>
            <p className="sub">
              {job.category ?? "General"} · updated {relativeTime(job.updatedAt)}
            </p>
          </div>
          <div className="dash-amount">
            <p>{formatBch(job.budgetSats)}</p>
            <Pill tone={jobStatusTone(job.status)}>{job.status.replace("_", " ")}</Pill>
          </div>
        </Link>
      ))}
    </div>
  );
}
