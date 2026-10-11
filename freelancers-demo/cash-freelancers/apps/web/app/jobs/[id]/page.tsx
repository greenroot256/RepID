import Link from "next/link";
import { notFound } from "next/navigation";
import type { Job, Proposal } from "@cash-freelancers/shared";
import { serverGet, ServerApiError } from "../../../lib/serverApi";
import { formatBch, relativeTime, ESCROW_MODE_LABEL, jobStatusTone } from "../../../lib/format";
import { Pill } from "../../components/ui";
import { BchAmount } from "../../components/BchAmount";
import { JobSidePanel } from "./JobSidePanel";
import { SubmitProposalForm } from "./SubmitProposalForm";
import { ProposalReview } from "./ProposalReview";
import { RateJobPanel } from "./RateJobPanel";

interface JobPageProps {
  params: Promise<{ id: string }>;
}

export default async function JobPage({ params }: JobPageProps) {
  const { id } = await params;

  // The two reads are independent, and the job may 404 while the proposals
  // call succeeds, so they are fetched together and the 404 decided from the
  // job alone.
  const [jobResult, proposals] = await Promise.all([
    serverGet<Job>(`/jobs/${id}`).catch((err) => err as unknown),
    serverGet<Proposal[]>(`/jobs/${id}/proposals`).catch(() => [] as Proposal[])
  ]);

  if (jobResult instanceof ServerApiError && jobResult.status === 404) notFound();
  if (jobResult instanceof Error) throw jobResult;
  const job = jobResult as Job;

  const openProposals = proposals.filter((p) => p.status !== "rejected");

  return (
    <section className="section">
      <div className="wrap detail-grid">
        <div>
          <p className="eyebrow">
            <Link href="/jobs" style={{ color: "inherit" }}>
              ← Explore work
            </Link>
          </p>
          <h1>{job.title}</h1>
          <div className="hero-actions" style={{ marginTop: 0, gap: 10 }}>
            <Pill tone={jobStatusTone(job.status)}>{job.status.replace("_", " ")}</Pill>
            {job.category && <Pill>{job.category}</Pill>}
            {job.preferredMode && <Pill>{ESCROW_MODE_LABEL[job.preferredMode]}</Pill>}
          </div>

          <div className="desc">
            {job.description.split(/\n{2,}/).map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>

          <hr className="divider" />

          <h3 style={{ fontSize: 18, marginBottom: 14 }}>
            Proposals{" "}
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>({openProposals.length})</span>
          </h3>

          {openProposals.length === 0 ? (
            <div className="empty">
              <p className="title">No proposals yet</p>
              <p className="sub">Be the first to put a proposal on this job.</p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {openProposals.map((proposal) => (
                <div key={proposal.id} className="dash-row">
                  <div>
                    <p className="title">{formatBch(proposal.proposedAmountSats)}</p>
                    <p className="sub">{relativeTime(proposal.createdAt)}</p>
                    {proposal.message && (
                      <p className="sub" style={{ color: "var(--text)", marginTop: 8 }}>
                        {proposal.message}
                      </p>
                    )}
                  </div>
                  <ProposalReview job={job} proposal={proposal} />
                </div>
              ))}
            </div>
          )}

          <SubmitProposalForm job={job} />
        </div>

        <aside className="sticky-side">
          <div className="card">
            <BchAmount sats={job.budgetSats} />
            <hr className="divider" />
            <div className="row">
              <span>Posted by</span>
              <b>{job.clientDisplayName ?? "Unknown"}</b>
            </div>
            {job.freelancerDisplayName && (
              <div className="row">
                <span>Freelancer</span>
                <b>{job.freelancerDisplayName}</b>
              </div>
            )}
            <div className="row">
              <span>Posted</span>
              <b>{relativeTime(job.createdAt)}</b>
            </div>
            {job.preferredMode && (
              <div className="row">
                <span>Escrow</span>
                <b>{ESCROW_MODE_LABEL[job.preferredMode]}</b>
              </div>
            )}
          </div>

          <JobSidePanel job={job} />
          <RateJobPanel job={job} />
        </aside>
      </div>
    </section>
  );
}
