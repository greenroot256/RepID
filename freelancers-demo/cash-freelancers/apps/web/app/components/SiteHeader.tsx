import Link from "next/link";
import { ConnectWalletButton } from "./ConnectWalletButton";

export function SiteHeader() {
  return (
    <header className="site">
      <nav className="site-nav">
        <Link href="/" className="logo">
          Cash <span>Freelancers</span>
        </Link>
        <div className="nav-links">
          <Link href="/jobs">Explore work</Link>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/#reputation">Reputation</Link>
        </div>
        <div className="nav-actions">
          <ConnectWalletButton />
        </div>
      </nav>
    </header>
  );
}
