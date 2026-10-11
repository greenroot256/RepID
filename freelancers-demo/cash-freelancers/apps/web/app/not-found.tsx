import Link from "next/link";

export default function NotFound() {
  return (
    <section className="section">
      <div className="wrap">
        <div className="empty-state">
          <h3>Not found</h3>
          <p>That page, job or escrow does not exist.</p>
          <p style={{ marginTop: 18 }}>
            <Link href="/jobs" className="btn btn-primary btn-sm">
              Explore work
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
