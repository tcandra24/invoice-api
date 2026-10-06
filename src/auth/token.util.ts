import { createHash, randomBytes } from 'crypto';

/** Refresh token: string acak 64 karakter (bukan JWT). */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

/**
 * Yang disimpan di database hanya hash-nya. SHA-256 cukup karena token
 * berentropi tinggi (berbeda dengan password buatan manusia yang butuh bcrypt),
 * dan memungkinkan pencarian langsung lewat hash.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
