import { db } from "../client.js";
import type { ActiveRole, User, UserRole, UserWallet } from "@cash-freelancers/shared";

interface UserRow {
  id: string;
  display_name: string;
  wallet_address: string;
  active_wallet_address: string;
  email: string | null;
  username: string | null;
  password_hash: string | null;
  active_role: ActiveRole;
  created_at: Date;
}

interface WalletRow {
  address: string;
  label: string | null;
  created_at: Date;
  last_used_at: Date | null;
}

function mapWallet(row: WalletRow, activeAddress: string): UserWallet {
  return {
    address: row.address,
    label: row.label ?? undefined,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString(),
    // Which wallet is active is stored once, on users.active_wallet_address,
    // so the answer cannot disagree with the column the foreign key guards.
    active: row.address === activeAddress
  };
}

function mapUser(
  row: UserRow,
  roles: UserRole[],
  wallets: UserWallet[],
  repId?: { repid_address: string; linked_at: Date }
): User {
  return {
    id: row.id,
    displayName: row.display_name,
    walletAddress: row.active_wallet_address,
    roles,
    wallets,
    email: row.email,
    username: row.username,
    activeRole: row.active_role,
    hasPassword: row.password_hash !== null,
    repId: repId
      ? { repIdAddress: repId.repid_address, linkedAt: repId.linked_at.toISOString() }
      : undefined,
    createdAt: row.created_at.toISOString()
  };
}

async function loadAccountData(userId: string, activeWalletAddress: string) {
  const [roleRows, repIdRows, walletRows] = await Promise.all([
    db.query<{ role: UserRole }>("SELECT role FROM user_roles WHERE user_id = $1", [userId]),
    db.query<{ repid_address: string; linked_at: Date }>(
      "SELECT repid_address, linked_at FROM repid_links WHERE user_id = $1",
      [userId]
    ),
    db.query<WalletRow>(
      "SELECT address, label, created_at, last_used_at FROM user_wallets WHERE user_id = $1 ORDER BY created_at ASC",
      [userId]
    )
  ]);
  return {
    roles: roleRows.rows.map((r) => r.role),
    repId: repIdRows.rows[0],
    wallets: walletRows.rows.map((row) => mapWallet(row, activeWalletAddress))
  };
}

async function hydrate(row: UserRow): Promise<User> {
  const { roles, repId, wallets } = await loadAccountData(row.id, row.active_wallet_address);
  return mapUser(row, roles, wallets, repId);
}

export async function createUser(input: {
  displayName: string;
  walletAddress: string;
  roles: UserRole[];
  username?: string;
  email?: string;
  passwordHash?: string;
}): Promise<User> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<UserRow>(
      `INSERT INTO users (display_name, wallet_address, username, email, password_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        input.displayName,
        input.walletAddress,
        input.username ?? null,
        input.email ?? null,
        input.passwordHash ?? null
      ]
    );
    const row = rows[0];
    // The first wallet is also the active one, and it has to be registered in
    // user_wallets in the same transaction — that table, not
    // users.wallet_address, is what a sign-in looks a wallet up against now.
    //
    // Order matters: user_wallets.user_id points at users, and the composite
    // foreign key (users.id, users.active_wallet_address) points at
    // user_wallets, so the wallet row has to exist before the active wallet
    // can be set. The foreign key alone would not catch this being skipped:
    // a NULL active_wallet_address satisfies a MATCH SIMPLE composite
    // constraint without being checked, which would leave a real account with
    // no wallet row and no active wallet, and no way to sign in again.
    await client.query("INSERT INTO user_wallets (user_id, address) VALUES ($1, $2)", [
      row.id,
      input.walletAddress
    ]);
    await client.query("UPDATE users SET active_wallet_address = $2 WHERE id = $1", [
      row.id,
      input.walletAddress
    ]);
    for (const role of input.roles) {
      await client.query("INSERT INTO user_roles (user_id, role) VALUES ($1, $2)", [row.id, role]);
    }
    await client.query("COMMIT");
    return mapUser(
      { ...row, active_wallet_address: input.walletAddress },
      input.roles,
      [
        {
          address: input.walletAddress,
          createdAt: row.created_at.toISOString(),
          active: true
        }
      ]
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Updates the caller's own display name and role set. Roles are replaced
 * wholesale by the caller of this function, which is why the route layer
 * restricts which ones may be granted — see routes/users.ts.
 */
export async function updateUserProfile(input: {
  userId: string;
  displayName: string;
  roles: UserRole[];
}): Promise<User> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<UserRow>(
      "UPDATE users SET display_name = $2 WHERE id = $1 RETURNING *",
      [input.userId, input.displayName]
    );
    const row = rows[0];
    if (!row) throw new Error(`User ${input.userId} not found`);

    await client.query("DELETE FROM user_roles WHERE user_id = $1", [input.userId]);
    for (const role of input.roles) {
      await client.query("INSERT INTO user_roles (user_id, role) VALUES ($1, $2)", [row.id, role]);
    }
    await client.query("COMMIT");

    const { repId, wallets } = await loadAccountData(input.userId, row.active_wallet_address);
    return mapUser(row, input.roles, wallets, repId);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function findUserById(id: string): Promise<User | undefined> {
  const { rows } = await db.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
  const row = rows[0];
  if (!row) return undefined;
  return hydrate(row);
}

/**
 * Resolves the account a wallet belongs to.
 *
 * Looks in user_wallets rather than users.wallet_address, which is what makes
 * a second linked wallet work: every wallet on the account is a way in, not
 * just the one that happened to be active when the account was created.
 */
export async function findUserByWalletAddress(walletAddress: string): Promise<User | undefined> {
  const { rows } = await db.query<UserRow>(
    `SELECT u.* FROM users u
     JOIN user_wallets w ON w.user_id = u.id
     WHERE w.address = $1`,
    [walletAddress]
  );
  const row = rows[0];
  if (!row) return undefined;
  return hydrate(row);
}

/**
 * The password sign-in lookup. The email is normalised to lower case first
 * because the uniqueness guarantee is a unique index on lower(email): without
 * that, `Ana@x.com` and `ana@x.com` would be the same account to the index and
 * different accounts to the login form.
 */
export async function findUserByEmail(email: string): Promise<User | undefined> {
  const { rows } = await db.query<UserRow>("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
  const row = rows[0];
  if (!row) return undefined;
  return hydrate(row);
}

/**
 * Whether a name is still free, for the "this one is taken" message the user
 * sees before they submit.
 *
 * Advisory. Two concurrent registrations can both read `true` here and only one
 * can win the unique index, so the routes still have to handle a 409 from the
 * insert — see the catch in /auth/register.
 */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const { rows } = await db.query("SELECT 1 FROM users WHERE lower(username) = lower($1)", [username]);
  return rows.length === 0;
}

export async function isEmailAvailable(email: string): Promise<boolean> {
  const { rows } = await db.query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [email]);
  return rows.length === 0;
}

/** The stored password hash, or null for accounts that never set one. */
export async function findPasswordHashByUserId(userId: string): Promise<string | null> {
  const { rows } = await db.query<{ password_hash: string | null }>(
    "SELECT password_hash FROM users WHERE id = $1",
    [userId]
  );
  return rows[0]?.password_hash ?? null;
}

export async function setPasswordHash(userId: string, passwordHash: string): Promise<User> {
  const { rows } = await db.query<UserRow>(
    "UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING *",
    [userId, passwordHash]
  );
  const row = rows[0];
  if (!row) throw new Error(`User ${userId} not found`);
  return hydrate(row);
}

export async function setActiveRole(userId: string, activeRole: ActiveRole): Promise<User> {
  const { rows } = await db.query<UserRow>(
    "UPDATE users SET active_role = $2 WHERE id = $1 RETURNING *",
    [userId, activeRole]
  );
  const row = rows[0];
  if (!row) throw new Error(`User ${userId} not found`);
  return hydrate(row);
}

/**
 * Adds a wallet to an account.
 *
 * The caller must already have proved control of `address` by signing a
 * challenge with it — see routes/users.ts. That proof is the whole point: a
 * stolen session must not be enough to attach somebody else's address to this
 * account, or an attacker could park a victim's wallet here and wait for it to
 * be used as a recovery path.
 */
export async function linkWallet(userId: string, address: string, label?: string): Promise<User> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO user_wallets (user_id, address, label) VALUES ($1, $2, $3)
       ON CONFLICT (address) DO NOTHING`,
      [userId, address, label ?? null]
    );
    const { rows } = await client.query<{ owner: string }>(
      "SELECT user_id AS owner FROM user_wallets WHERE address = $1",
      [address]
    );
    if (rows[0].owner !== userId) {
      throw new Error("That wallet is already linked to another account");
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  const user = await findUserById(userId);
  if (!user) throw new Error(`User ${userId} not found`);
  return user;
}

/**
 * Points the account at one of its own wallets.
 *
 * Forward-only by design: existing escrows keep the addresses they froze at
 * creation, so this decides what *new* escrows use and nothing else. A user who
 * loses a wallet adds a new one and activates it, and the account keeps both
 * the reputation and any escrow that is not yet settled.
 */
export async function setActiveWallet(userId: string, address: string): Promise<User> {
  /*
   * The membership test and the write are one statement, on purpose.
   *
   * Checking with a SELECT and then updating would leave a window where a
   * concurrent unlink — not currently possible, but the shape of the bug is what
   * matters — could remove the row in between. Worse, it is the kind of check
   * that looks like an authorisation decision but lives far from the write, so
   * the next person to edit this function can remove it without breaking
   * anything visible. Expressing it as part of the WHERE clause means an address
   * that is not this account's cannot become this account's active wallet, and
   * rowCount === 0 is the whole answer.
   */
  const { rowCount } = await db.query(
    `UPDATE users SET active_wallet_address = $2
     WHERE id = $1
       AND EXISTS (SELECT 1 FROM user_wallets WHERE user_id = $1 AND address = $2)`,
    [userId, address]
  );
  if (!rowCount) {
    throw new Error("That wallet is not linked to this account");
  }
  const user = await findUserById(userId);
  if (!user) throw new Error(`User ${userId} not found`);
  return user;
}

export async function touchWalletLastUsed(address: string): Promise<void> {
  await db.query("UPDATE user_wallets SET last_used_at = now() WHERE address = $1", [address]);
}

export async function linkRepId(userId: string, repIdAddress: string): Promise<void> {
  await db.query(
    `INSERT INTO repid_links (user_id, repid_address) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET repid_address = EXCLUDED.repid_address, linked_at = now()`,
    [userId, repIdAddress]
  );
}
