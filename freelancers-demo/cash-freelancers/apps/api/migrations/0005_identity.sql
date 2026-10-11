-- Identity: password login, several wallets per account with one active, and
-- per-resource role switching.
--
-- The account is no longer the wallet. Three things follow from that, and the
-- third is the reason this migration is careful about ordering.

-- ---------------------------------------------------------------------------
-- 1. user_wallets
-- ---------------------------------------------------------------------------
-- An account can hold several wallets, and exactly one is active. The active
-- one is stored on `users.active_wallet_address` rather than as a boolean
-- here: two places holding "which one is active" is two places to disagree.
-- `UserWallet.active` is derived from that column in the repository.
--
-- `address` is UNIQUE on its own, not per user. That is the constraint that
-- stops a wallet from being attached to two different accounts, which would
-- otherwise be an account-takeover path: sign in with a wallet that already
-- belongs to someone else and get handed their row.
CREATE TABLE user_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  -- Also the target of the composite foreign key from users below, which needs
  -- this pair to be uniquely addressable.
  UNIQUE (user_id, address)
);

CREATE INDEX idx_user_wallets_user ON user_wallets(user_id);

-- Every existing account has exactly one wallet today, held in
-- users.wallet_address. Carry it over so no account is left without one.
INSERT INTO user_wallets (user_id, address)
SELECT id, wallet_address FROM users;

-- ---------------------------------------------------------------------------
-- 2. users: active wallet, credentials, active role
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN active_wallet_address TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN active_role TEXT NOT NULL DEFAULT 'client';

-- Must run after the backfill below, since the foreign key is checked on
-- every existing row, not just new ones.
UPDATE users SET active_wallet_address = wallet_address;

-- The active wallet has to be one of this account's own wallets. Expressing
-- that as a foreign key means the database rejects an active wallet belonging
-- to somebody else, rather than trusting the route layer to never send one.
ALTER TABLE users
  ADD CONSTRAINT users_active_wallet_fk
  FOREIGN KEY (id, active_wallet_address)
  REFERENCES user_wallets(user_id, address);

-- 'arbiter' is a service someone offers, not a mode they work in, so it is
-- not a legal active role. Kept as a CHECK rather than an enum type so adding
-- a role later is a constraint swap instead of an ALTER TYPE.
ALTER TABLE users
  ADD CONSTRAINT users_active_role_check
  CHECK (active_role IN ('client', 'freelancer'));

-- Nullable on purpose. Accounts created before passwords existed have neither
-- an email nor a username, and they can still sign in with a linked wallet;
-- setting a password is how they become recoverable if they lose that wallet.
-- Postgres lets NULLs repeat in a unique index, so backfilled accounts do not
-- collide with each other here.
--
-- Indexed on lower() because two accounts differing only in the case of an
-- email are the same account as far as anyone typing it is concerned.
CREATE UNIQUE INDEX idx_users_email ON users (lower(email));
CREATE UNIQUE INDEX idx_users_username ON users (lower(username));

-- ---------------------------------------------------------------------------
-- 3. Freeze the wallet addresses onto each escrow
-- ---------------------------------------------------------------------------
-- This is the part that protects money already on chain.
--
-- Until now an escrow stored no addresses at all: routes/escrows.ts resolved
-- the client, freelancer and arbiter wallets from users.wallet_address on
-- every single request, and derived the covenant's public key hashes from
-- them. That was fine while a wallet was the whole identity. It stops being
-- fine the moment an account can have a second wallet and switch to it: the
-- three public key hashes would change underneath a covenant that is already
-- funded, and the funds would sit there unspendable until the timeout.
--
-- So the addresses are copied onto the escrow once, at migration time, and
-- never change afterwards. Changing which wallet is active is a forward-only
-- operation: it decides what new escrows use, and leaves existing ones alone.
ALTER TABLE escrows ADD COLUMN client_wallet_address TEXT;
ALTER TABLE escrows ADD COLUMN freelancer_wallet_address TEXT;
ALTER TABLE escrows ADD COLUMN arbiter_wallet_address TEXT;

-- Escrows in this database should always belong to a job that already has a
-- freelancer assigned, but the freeze depends on it, and a NOT NULL that fails
-- halfway through is a confusing way to find out. Fail first, with a message
-- that says what to fix.
DO $$
DECLARE
  orphans INTEGER;
BEGIN
  SELECT count(*) INTO orphans
  FROM escrows e
  JOIN jobs j ON j.id = e.job_id
  WHERE j.freelancer_id IS NULL;

  IF orphans > 0 THEN
    RAISE EXCEPTION
      'Cannot freeze escrow wallets: % escrow(s) belong to a job with no freelancer assigned. Assign a freelancer to those jobs first, then re-run this migration.', orphans;
  END IF;
END $$;

-- Client and freelancer, resolved through the escrow's job.
UPDATE escrows e
SET client_wallet_address = c.wallet_address,
    freelancer_wallet_address = f.wallet_address
FROM jobs j, users c, users f
WHERE e.job_id = j.id
  AND c.id = j.client_id
  AND f.id = j.freelancer_id;

-- Arbiter, only present on arbitrated escrows.
UPDATE escrows e
SET arbiter_wallet_address = u.wallet_address
FROM users u
WHERE e.arbiter_id = u.id;

ALTER TABLE escrows
  ALTER COLUMN client_wallet_address SET NOT NULL,
  ALTER COLUMN freelancer_wallet_address SET NOT NULL;

-- Mirrors the mode/arbiter_id CHECK from 0001_init.sql: an arbitrated escrow
-- needs an arbiter wallet too, and a bilateral one must not have one.
ALTER TABLE escrows
  ADD CONSTRAINT escrows_arbiter_wallet_check
  CHECK (
    (mode = 'bilateral' AND arbiter_wallet_address IS NULL) OR
    (mode = 'arbitrated' AND arbiter_wallet_address IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 4. Record how a session was established
-- ---------------------------------------------------------------------------
-- 'wallet' or 'password'. Worth having from the start: password login is the
-- path where brute-force protection matters, and a table that cannot tell the
-- two apart cannot be audited for it.
ALTER TABLE sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'wallet';

ALTER TABLE sessions
  ADD CONSTRAINT sessions_auth_method_check
  CHECK (auth_method IN ('wallet', 'password'));
