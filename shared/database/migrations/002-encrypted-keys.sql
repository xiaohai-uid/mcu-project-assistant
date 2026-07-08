ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 hash of the raw key value for fast lookup without decryption';
COMMENT ON COLUMN api_keys.key_value_encrypted IS 'AES-256-GCM encrypted key value (format: iv:authTag:ciphertext)';