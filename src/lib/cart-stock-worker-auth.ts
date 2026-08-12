import crypto from "crypto";
import { NextRequest } from "next/server";
import { registerCartStockWorkerNonce } from "@/lib/cart-stock-jobs";

const MAX_CLOCK_SKEW_SECONDS = 300;
const WORKER_ID_PATTERN = /^[a-zA-Z0-9._-]{3,80}$/;
const NONCE_PATTERN = /^[a-zA-Z0-9-]{16,100}$/;

export class CartStockWorkerAuthError extends Error {
  constructor(message: string, public readonly status = 401) {
    super(message);
  }
}

function safeEqual(left: string, right: string): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export async function verifyCartStockWorkerRequest(
  request: NextRequest,
  rawBody: string,
): Promise<string> {
  const secret = process.env.MPHUB_CART_STOCK_WORKER_SECRET?.trim() || "";
  if (!secret) throw new CartStockWorkerAuthError("Cart stock worker secret is not configured", 503);

  const workerId = request.headers.get("x-mphub-worker-id") || "";
  const timestampRaw = request.headers.get("x-mphub-worker-timestamp") || "";
  const nonce = request.headers.get("x-mphub-worker-nonce") || "";
  const signature = request.headers.get("x-mphub-worker-signature") || "";
  if (!WORKER_ID_PATTERN.test(workerId) || !NONCE_PATTERN.test(nonce)) {
    throw new CartStockWorkerAuthError("Invalid worker identity headers");
  }

  const timestamp = Number(timestampRaw);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    throw new CartStockWorkerAuthError("Worker request timestamp is outside the allowed window");
  }

  const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");
  const message = [timestampRaw, nonce, request.method.toUpperCase(), request.nextUrl.pathname, bodyHash].join("\n");
  const expected = crypto.createHmac("sha256", secret).update(message).digest("hex");
  if (!safeEqual(signature, expected)) {
    throw new CartStockWorkerAuthError("Invalid worker request signature");
  }
  if (!await registerCartStockWorkerNonce(nonce)) {
    throw new CartStockWorkerAuthError("Worker request nonce was already used", 409);
  }
  return workerId;
}
