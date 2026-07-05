import { db } from "./database";
import { decrypt } from "./encryption";

export async function resolveDecryptedApiKey(userId: string): Promise<string | undefined> {
  const result = await db.query(
    `SELECT key_value_encrypted FROM api_keys
     WHERE user_id = $1 AND is_active = true AND key_type = 'ai'`,
    [userId]
  );
  if (result.rows.length === 0) return undefined;
  return decrypt(result.rows[0].key_value_encrypted);
}
