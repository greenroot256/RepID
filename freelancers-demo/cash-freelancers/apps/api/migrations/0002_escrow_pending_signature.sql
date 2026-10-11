-- Storage for the EscrowArbitrated two-step co-signing flow (see
-- packages/wallet-connect's startTwoPartySignature/completeTwoPartySignature
-- and the root README's "Two-step signing" section). Holds the first
-- co-signer's partially-signed transaction until the second co-signer is
-- ready to complete it.
ALTER TABLE escrows
  ADD COLUMN pending_signature_hex TEXT,
  ADD COLUMN pending_signature_by UUID REFERENCES users(id),
  ADD COLUMN pending_outcome TEXT CHECK (pending_outcome IN ('release', 'refund'));
