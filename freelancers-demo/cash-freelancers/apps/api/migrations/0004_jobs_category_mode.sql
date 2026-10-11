-- Marketplace discovery metadata.
--
-- `category` lets the public job board be filtered the way a marketplace
-- needs to be filtered (design / development / writing / marketing), which was
-- previously impossible: jobs only had a title, a description and a budget.
--
-- `preferred_mode` records which escrow flavour the client wants *before* an
-- escrow exists. The `escrow_mode` column itself still lives on `escrows`,
-- because the escrow is the thing that actually gets a CashScript contract
-- address; this column is only the client's intent, used as the default when
-- POST /escrows is called.
--
-- Both are nullable so every pre-existing job keeps working unchanged.
ALTER TABLE jobs
  ADD COLUMN category TEXT,
  ADD COLUMN preferred_mode escrow_mode;

-- Indexes backing the two new list queries: the public board filters by
-- category, and the dashboard filters by status per user.
CREATE INDEX idx_jobs_category ON jobs (category);
CREATE INDEX idx_jobs_freelancer ON jobs (freelancer_id);
