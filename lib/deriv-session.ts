import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const COOKIE = "digitlab_deriv_session";

function encryptionKey(): Buffer {
  const secret = process.env.DERIV_SESSION_SECRET || process.env.DERIV_OAUTH_CLIENT_SECRET;
  if (!secret) throw new Error("Deriv session encryption secret is not configured");
  return createHash("sha256").update(secret).digest();
}

export function encryptSession(value: { accessToken: string; expiresAt: number }): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function decryptSession(value?: string): { accessToken: string; expiresAt: number } | null {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const session = JSON.parse(json) as { accessToken: string; expiresAt: number };
    if (!session.accessToken || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}

export { COOKIE as DERIV_SESSION_COOKIE };