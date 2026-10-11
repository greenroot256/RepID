import { EscrowView } from "./EscrowView";

export const metadata = { title: "Escrow — Cash Freelancers" };

export default async function EscrowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <section className="section">
      <div className="wrap">
        <EscrowView escrowId={id} />
      </div>
    </section>
  );
}
