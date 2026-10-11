export type UserRole = "client" | "freelancer" | "arbiter";

/**
 * The side of the marketplace a user is currently operating on.
 *
 * Narrower than `UserRole` on purpose. "arbiter" is a service someone offers
 * the platform, not a mode they work in, so it is never an active role and
 * the role gate never applies to an arbiter acting on a dispute.
 *
 * The API treats this as a *declaration of intent* and validates it against
 * the role the caller actually holds on the specific resource being touched.
 * Being in "freelancer" mode does not forbid you from releasing a payment on
 * an escrow where you are the client — it only forbids you from acting on
 * that escrow as its client while declaring freelancer mode, which is the
 * mistake the switch exists to catch.
 */
export type ActiveRole = "client" | "freelancer";

/**
 * A wallet linked to an account. An account can hold several, and exactly one
 * of them is active at a time.
 *
 * "Active" only decides which wallet is used for *new* escrows and as the
 * default when asking a wallet to sign. It deliberately does not retroactively
 * change escrows that already exist: those freeze the wallet addresses they
 * were created with, because the covenant's public key hashes are derived from
 * them and rewriting those would strand funds that are already locked up.
 */
export interface UserWallet {
  address: string;
  /** Optional human label, e.g. "hot wallet" or "hardware". */
  label?: string;
  createdAt: string;
  lastUsedAt?: string;
  /** True for the single wallet marked active on the account. */
  active: boolean;
}

export interface RepIdLink {
  repIdAddress: string;
  linkedAt: string;
}

export interface User {
  id: string;
  /** Free-text name shown in the UI. Mutable, not unique. */
  displayName: string;
  roles: UserRole[];
  /**
   * The wallet currently marked active on this account — a convenience alias
   * for the entry in `wallets` whose `active` is true. The rest of the codebase
   * reads it; the multi-wallet work moves consumers over to `wallets` where the
   * distinction matters.
   */
  walletAddress: string;
  repId?: RepIdLink;
  createdAt: string;

  /**
   * Login identifier, unique across accounts. Null only for accounts created
   * before passwords existed, which can still sign in with a linked wallet and
   * are prompted to set one.
   *
   * Not proof of ownership: nothing verifies it, so it must never be treated as
   * a trust signal, only as a name to look the account up by.
   */
  email: string | null;
  /** Unique public handle. Null for accounts predating it. Distinct from
   *  `displayName`, which is free text. */
  username: string | null;
  /** Every wallet linked to this account, oldest first. Never empty: an
   *  account is created with a wallet and wallets are only ever added. */
  wallets: UserWallet[];
  /** Which side of the marketplace the user is working on right now. */
  activeRole: ActiveRole;
  /**
   * False for accounts that predate passwords and have not set one yet. Those
   * are only recoverable through one of their linked wallets.
   */
  hasPassword: boolean;
}
