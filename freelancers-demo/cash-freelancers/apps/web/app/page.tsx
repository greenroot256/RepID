import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <p className="eyebrow">Payments on Bitcoin Cash</p>
            <h1 className="headline">Hire talent. Pay in BCH. Keep the money honest.</h1>
            <p className="sub">
              A freelance marketplace where every payment is locked in an on-chain smart contract until
              the work is delivered. No invoices, no chargebacks, no waiting.
            </p>
            <div className="hero-actions">
              <Link href="/jobs" className="btn btn-primary">
                Browse jobs
              </Link>
              <Link href="/jobs/new" className="btn btn-line">
                Post a job
              </Link>
            </div>
          </div>

          {/* The live escrow card from the reference, with real values. */}
          <div className="card">
            <div className="card-head">
              <div>
                <p className="label">Active escrow</p>
                <p className="job">Landing page redesign</p>
              </div>
              <span className="pill">Funded</span>
            </div>

            <p className="amount">0.31 BCH</p>
            <p className="amount-usd">≈ $47.50</p>

            <hr className="divider" />

            <div className="row">
              <span>Escrow type</span>
              <b>3-party escrow</b>
            </div>
            <div className="row">
              <span>Client</span>
              <b>Nadia R.</b>
            </div>
            <div className="row">
              <span>Freelancer</span>
              <b>Marcos T.</b>
            </div>
            <div className="row">
              <span>Arbiter</span>
              <b>Paytaca DAO</b>
            </div>
            <div className="row">
              <span>Contract</span>
              <b className="mono">bcrt1q9x…8f3k</b>
            </div>

            <div className="rep-badge">
              <span className="rep-dot" aria-hidden="true" />
              <span>Both parties carry a RepID</span>
              <b>98% trust score</b>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="how-it-works">
        <div className="wrap">
          <div className="section-head">
            <h2 className="section-title">How it works</h2>
            <p>
              The contract holds the money and decides when it moves. Not the platform, not a payment
              provider, and not either party on their own.
            </p>
          </div>

          <div className="steps">
            <div className="step">
              <p className="step-num">01</p>
              <h3>Agree on the work</h3>
              <p>
                Post a job or apply to one. When both sides agree on a price, the client funds an
                escrow contract on the Bitcoin Cash chain.
              </p>
            </div>
            <div className="step">
              <p className="step-num">02</p>
              <h3>Work happens in escrow</h3>
              <p>
                The BCH sits in the contract, not with the freelancer. Neither side can take it back
                unilaterally, which is what makes both sides commit.
              </p>
            </div>
            <div className="step">
              <p className="step-num">03</p>
              <h3>Release, or reclaim</h3>
              <p>
                The client releases the payment when the work lands. If the freelancer goes quiet, they
                can reclaim the funds once the agreed timeout passes.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <h2 className="section-title">Choose how much trust you need</h2>
            <p>
              Two flavours of the same covenant. Pick per job; the freelancer sees which one they are
              applying to before they send a proposal.
            </p>
          </div>

          <div className="escrow-modes">
            <div className="mode active">
              <span className="mode-tag">Cheapest</span>
              <h3>2-party escrow</h3>
              <p>
                Client releases the payment; the freelancer can reclaim it after the timeout. No
                third party, no fees beyond the network.
              </p>
            </div>
            <div className="mode">
              <span className="mode-tag">Strongest</span>
              <h3>3-party escrow</h3>
              <p>
                A neutral arbiter co-signs the release. If the two sides disagree, the arbiter decides
                whether the money goes to the freelancer or back to the client.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="reputation">
        <div className="wrap">
          <div className="rep-section">
            <div>
              <h2>Reputation you can take with you</h2>
              <p>
                Every account can carry a RepID: a reputation token minted on-chain and linked to your
                wallet. Ratings accumulate into a trust score that is yours, not the platform&rsquo;s.
              </p>
              <p>
                Cash Freelancers can read it to warn about a new account, but nothing in the escrow
                depends on it. Trust a score, or ignore it and rely on the contract instead.
              </p>
              <div className="rep-points">
                <div>Portable across any site that reads RepIDs</div>
                <div>Set by the work you did, not by a subscription</div>
                <div>Optional: the covenant never asks for it</div>
              </div>
            </div>

            <div className="id-chip">
              <div className="id-row">
                <span>RepID</span>
                <b className="mono">bcrt1rep…9x2m</b>
              </div>
              <div className="id-row">
                <span>Owner</span>
                <b className="mono">bcrt1q7y…4a1p</b>
              </div>
              <div className="id-row">
                <span>Trust score</span>
                <b>98%</b>
              </div>
              <div className="id-row">
                <span>Jobs completed</span>
                <b>27</b>
              </div>
              <div className="id-row">
                <span>Disputes lost</span>
                <b>0</b>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
