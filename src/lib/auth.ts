/**
 * Auth utilities — password hashing + JWT-like tokens.
 * Uses Node.js built-in crypto only (no external deps).
 */

import crypto from "crypto";

const IS_PRODUCTION_RUNTIME =
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build";

const JWT_SECRET = process.env.JWT_SECRET || (IS_PRODUCTION_RUNTIME ? "" : "mphub-dev-secret-2026");
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required in production runtime");
}
import { AUTH } from "./constants";

const TOKEN_TTL = AUTH.TOKEN_TTL_SECONDS;
const PBKDF2_ALGORITHM = "sha256";
const PBKDF2_ITERATIONS = 310000;
const PBKDF2_KEY_LENGTH = 32;

// --- Password hashing ---

/** Returns "pbkdf2-sha256:iterations:salt:hash" */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_ALGORITHM)
    .toString("hex");
  return `pbkdf2-${PBKDF2_ALGORITHM}:${PBKDF2_ITERATIONS}:${salt}:${hash}`;
}

function safeHexEqual(leftHex: string, rightHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(leftHex) || !/^[0-9a-f]+$/i.test(rightHex)) return false;
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isLegacyPasswordHash(storedHash: string): boolean {
  return !storedHash.startsWith(`pbkdf2-${PBKDF2_ALGORITHM}:`) && storedHash.split(":").length === 2;
}

/** Verifies password against current PBKDF2 hashes and legacy "salt:sha256hash" hashes. */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash.startsWith(`pbkdf2-${PBKDF2_ALGORITHM}:`)) {
    const [, iterationsRaw, salt, hash] = storedHash.split(":");
    const iterations = Number(iterationsRaw);
    if (!Number.isSafeInteger(iterations) || iterations < 100000 || !salt || !hash) return false;
    const computed = crypto
      .pbkdf2Sync(password, salt, iterations, PBKDF2_KEY_LENGTH, PBKDF2_ALGORITHM)
      .toString("hex");
    return safeHexEqual(computed, hash);
  }

  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const computed = crypto.createHash("sha256").update(salt + password).digest("hex");
  return safeHexEqual(computed, hash);
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
