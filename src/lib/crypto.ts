/**
 * AES-256-GCM encryption for OAuth tokens at rest.
 *
 * Refresh tokens are long-lived credentials to a user's YouTube account. Supabase already
 * encrypts the disk, but that does not protect against a leaked database dump or an
 * over-permissive query. Encrypting at the application layer means a stolen row is inert
 * without TOKEN_ENCRYPTION_KEY, which lives only in the server environment.
 */
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { serverEnv } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits, the GCM standard
const AUTH_TAG_LENGTH = 16;

function key(): Buffer {
  const raw = Buffer.from(serverEnv.tokenEncryptionKey, "base64");
  if (raw.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be 32 bytes base64-encoded. Generate one with: openssl rand -base64 32",
    );
  }
  return raw;
}

/** Returns base64 of iv || authTag || ciphertext. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decrypt(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted payload is malformed.");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Extension bearer tokens are stored as hashes, so a database leak cannot impersonate an install. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Pairing codes are read aloud and retyped, so avoid 0/O/1/I/L ambiguity. */
const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomPairingCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
  }
  return code;
}
