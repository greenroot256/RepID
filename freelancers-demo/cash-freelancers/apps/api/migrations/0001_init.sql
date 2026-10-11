CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('client', 'freelancer', 'arbiter');
CREATE TYPE job_status AS ENUM ('open', 'in_progress', 'delivered', 'completed', 'cancelled');
CREATE TYPE proposal_status AS ENUM ('sent', 'accepted', 'rejected');
CREATE TYPE escrow_mode AS ENUM ('bilateral', 'arbitrated');
CREATE TYPE escrow_status AS ENUM ('pending_funding', 'funded', 'released', 'refunded', 'disputed');
CREATE TYPE dispute_status AS ENUM ('open', 'resolved');

-- Users: the wallet is the base identity. RepID is a separate, optional
-- 1-to-1 link, not every user has one.
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  wallet_address TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A user can hold several roles at once (e.g. client and arbiter).
CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE repid_links (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  repid_address TEXT NOT NULL UNIQUE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Extended profile for users who offer arbitration as a service on the
-- platform (role "arbiter" in user_roles).
CREATE TABLE arbiter_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT,
  fee_bps INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  disputes_resolved INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES users(id),
  freelancer_id UUID REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  budget_sats BIGINT NOT NULL CHECK (budget_sats > 0),
  status job_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  freelancer_id UUID NOT NULL REFERENCES users(id),
  message TEXT,
  proposed_amount_sats BIGINT NOT NULL CHECK (proposed_amount_sats > 0),
  status proposal_status NOT NULL DEFAULT 'sent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, freelancer_id)
);

-- One escrow per job. The mode decides whether an arbiter is required:
-- "bilateral" never has arbiter_id, "arbitrated" always does.
CREATE TABLE escrows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  mode escrow_mode NOT NULL,
  contract_address TEXT NOT NULL,
  amount_sats BIGINT NOT NULL CHECK (amount_sats > 0),
  status escrow_status NOT NULL DEFAULT 'pending_funding',
  arbiter_id UUID REFERENCES users(id),
  funding_txid TEXT,
  release_txid TEXT,
  timeout_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (mode = 'bilateral' AND arbiter_id IS NULL) OR
    (mode = 'arbitrated' AND arbiter_id IS NOT NULL)
  )
);

CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id UUID NOT NULL REFERENCES escrows(id) ON DELETE CASCADE,
  opened_by UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status dispute_status NOT NULL DEFAULT 'open',
  resolution TEXT,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ratings between the parties of a job (client <-> freelancer, and from
-- either of them towards the arbiter if one was involved).
-- repid_synced flags whether a rating has already been written as an
-- on-chain event in RepID.
CREATE TABLE ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  rater_id UUID NOT NULL REFERENCES users(id),
  ratee_id UUID NOT NULL REFERENCES users(id),
  score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  repid_synced BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, rater_id, ratee_id)
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_client ON jobs(client_id);
CREATE INDEX idx_proposals_job ON proposals(job_id);
CREATE INDEX idx_escrows_status ON escrows(status);
CREATE INDEX idx_ratings_ratee ON ratings(ratee_id);
