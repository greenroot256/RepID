import { Profile } from "./Profile";

export const metadata = { title: "Profile — Cash Freelancers" };

export default function ProfilePage() {
  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <h2 className="section-title">Your profile</h2>
          <p>
            Your account is separate from your wallets: sign in with your email and password, keep
            one or more wallets linked, and pick which one new escrows use.
          </p>
        </div>
        <Profile />
      </div>
    </section>
  );
}
