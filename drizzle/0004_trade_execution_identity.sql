-- Both feeds use transaction/wallet/token/side as their logical identity.
-- Enforce it at insertion time, including concurrent imports from two sources.
CREATE UNIQUE INDEX IF NOT EXISTS trades_execution_identity
ON trades (tx_hash, trader_id, token_address, side);
