import { Dashboard } from "./Dashboard";

export const metadata = { title: "Dashboard — Cash Freelancers" };

export default function DashboardPage() {
  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <h2 className="section-title">Your work</h2>
          <p>Every job and escrow you are a party to, on either side of the deal.</p>
        </div>
        <Dashboard />
      </div>
    </section>
  );
}
