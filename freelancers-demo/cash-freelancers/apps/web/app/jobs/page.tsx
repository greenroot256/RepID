import Link from "next/link";
import type { Job, JobStatus } from "@cash-freelancers/shared";
import { JOB_CATEGORIES } from "@cash-freelancers/shared";
import { serverGet } from "../../lib/serverApi";
import { formatBch, relativeTime, jobStatusTone } from "../../lib/format";
import { Pill, EmptyState } from "../components/ui";

export const metadata = { title: "Explore work — Cash Freelancers" };

const PAGE_SIZE = 12;

interface JobsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const params = await searchParams;
  const category = firstValue(params.category);
  const status = firstValue(params.status);
  const offset = Number(firstValue(params.offset) ?? "0") || 0;

  // The API validates both filters and answers 400 on an unknown value, so an
  // unknown category from a hand-edited URL is dropped here rather than turned
  // into an error page.
  const query = new URLSearchParams();
  if (category && (JOB_CATEGORIES as readonly string[]).includes(category)) {
    query.set("category", category);
  }
  if (status === "open" || status === "in_progress" || status === "delivered") {
    query.set("status", status);
  }
  query.set("limit", String(PAGE_SIZE));
  query.set("offset", String(offset));

  const jobs = await serverGet<Job[]>(`/jobs?${query.toString()}`);

  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <h2 className="section-title">Explore work</h2>
          <p>Every budget below is locked in a Bitcoin Cash escrow before any work starts.</p>
        </div>

        <div className="filters">
          <CategoryFilter label="All work" category={category} />
          {JOB_CATEGORIES.map((c) => (
            <CategoryFilter key={c} label={c} category={category} value={c} />
          ))}
        </div>

        {jobs.length === 0 ? (
          <EmptyState title="No jobs here yet">
            <p>Nothing matches this filter. Try another category, or post the job yourself.</p>
            <p style={{ marginTop: 18 }}>
              <Link href="/jobs/new" className="btn btn-primary btn-sm">
                Post a job
              </Link>
            </p>
          </EmptyState>
        ) : (
          <div className="job-grid">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}

        <Pagination offset={offset} count={jobs.length} category={category} status={status} />
      </div>
    </section>
  );
}

function JobCard({ job }: { job: Job }) {
  return (
    <Link href={`/jobs/${job.id}`} className="job-card">
      <span className="cat">{job.category ?? "General"}</span>
      <h3>{job.title}</h3>
      <p>{job.description}</p>
      <div className="meta">
        <span className="mono">{formatBch(job.budgetSats)}</span>
        <Pill tone={jobStatusTone(job.status)}>{statusLabel(job.status)}</Pill>
        <span>{relativeTime(job.createdAt)}</span>
      </div>
    </Link>
  );
}

function CategoryFilter({
  label,
  category,
  value
}: {
  label: string;
  category?: string;
  value?: string;
}) {
  const active = (category ?? undefined) === value;
  // A plain link rather than a button + onClick: the filter state belongs in the
  // URL, so the board is linkable, back-button friendly and server-rendered.
  const href = value ? `/jobs?category=${encodeURIComponent(value)}` : "/jobs";
  return (
    <Link href={href} className={active ? "filter active" : "filter"}>
      {label}
    </Link>
  );
}

function Pagination({
  offset,
  count,
  category,
  status
}: {
  offset: number;
  count: number;
  category?: string;
  status?: string;
}) {
  if (offset === 0 && count < PAGE_SIZE) return null;

  const href = (next: number) => {
    const query = new URLSearchParams();
    if (category) query.set("category", category);
    if (status) query.set("status", status);
    if (next > 0) query.set("offset", String(next));
    const qs = query.toString();
    return qs ? `/jobs?${qs}` : "/jobs";
  };

  return (
    <div className="hero-actions" style={{ marginTop: 32 }}>
      {offset > 0 && (
        <Link href={href(Math.max(0, offset - PAGE_SIZE))} className="btn btn-line btn-sm">
          ← Previous
        </Link>
      )}
      {count === PAGE_SIZE && (
        <Link href={href(offset + PAGE_SIZE)} className="btn btn-line btn-sm">
          Next →
        </Link>
      )}
    </div>
  );
}

function statusLabel(status: JobStatus): string {
  switch (status) {
    case "open":
      return "Open";
    case "in_progress":
      return "In progress";
    case "delivered":
      return "Delivered";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
  }
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
