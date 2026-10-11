import { NewJobForm } from "./NewJobForm";

export const metadata = { title: "Post a job — Cash Freelancers" };

export default function NewJobPage() {
  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <h2 className="section-title">Post a job</h2>
          <p>
            The budget you set becomes the amount locked in escrow. Nothing is charged until you accept
            a proposal and fund the contract yourself.
          </p>
        </div>
        <NewJobForm />
      </div>
    </section>
  );
}
