-- Bind each signed challenge to the action it authorises.
--
-- A challenge's message is what the user actually reads and approves in their
-- wallet, and until now every challenge said the same thing: "Cash Freelancers
-- wants you to sign in." Now that a signed challenge is also how you prove
-- control of a *second* wallet (to link it, or to make it the active one),
-- that wording would be a lie — the user would be asked to approve a sign-in
-- and actually be handing over permission to attach a wallet to their account.
--
-- Recording the purpose separately from the message means the verifying route
-- can refuse a signature that was captured for a different action, instead of
-- trusting whatever the message happens to say.
--
-- The default is 'sign-in' because every challenge issued before this
-- migration was, in fact, a sign-in.

ALTER TABLE auth_challenges
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'sign-in';

ALTER TABLE auth_challenges
  ADD CONSTRAINT auth_challenges_purpose_check
  CHECK (purpose IN ('sign-in', 'link-wallet', 'activate-wallet'));

CREATE INDEX idx_auth_challenges_purpose ON auth_challenges(purpose);
