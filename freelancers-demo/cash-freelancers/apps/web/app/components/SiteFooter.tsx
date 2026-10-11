import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site">
      <div className="wrap footer-row">
        <div>© 2026 Cash Freelancers</div>
        <div className="footer-links">
          <Link href="/jobs">Explore work</Link>
          <Link href="/jobs/new">Post a job</Link>
          <Link href="/dashboard">Dashboard</Link>
        </div>
      </div>
    </footer>
  );
}
