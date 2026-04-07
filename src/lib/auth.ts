/**
 * Auth utilities — password hashing + JWT-like tokens.
 * Uses Node.js built-in crypto only (no external deps).
 */

import crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "mphub-dev-secret-2026";
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  console.warn("[AUTH] WARNING: JWT_SECRET not set — using insecure default. Set JWT_SECRET env variable!");
}
import { AUTH } from "./constants";

const TOKEN_TTL = AUTH.TOKEN_TTL_SECONDS;

// --- Password hashing ---

/** Returns "salt:hash" where hash = sha256(salt + password) */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

/** Verifies password against stored "salt:hash" */
export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const computed = crypto.createHash("sha256").update(salt + password).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(hash, "hex"));
}

// --- Token (custom JWT-like: base64url(header).base64url(payload).hmac-sha256) ---

interface TokenPayload {
  userId: number;
  iat: number;
  exp: number;
}

function base64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

function fromBase64url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

export function createToken(userId: number): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = { userId, iat: now, exp: now + TOKEN_TTL };
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): { userId: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = crypto
      .createHmac("sha256", JWT_SECRET)
      .update(`${header}.${body}`)
      .digest("base64url");
    // Constant-time compare
    if (sig.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
    const payload: TokenPayload = JSON.parse(fromBase64url(body));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
