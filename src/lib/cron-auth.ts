import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

const CRON_SECRET_PATH = path.join(process.cwd(), "data", "cron-secret.txt");
const HEADER = "x-mphub-cron-secret";

function readCronSecret(): string {
  const fromEnv = process.env.MPHUB_CRON_SECRET?.trim();
  if (fromEnv) return fromEnv;

  try {
    if (fs.existsSync(CRON_SECRET_PATH)) {
      return fs.readFileSync(CRON_SECRET_PATH, "utf-8").trim();
    }
  } catch { /* ignore */ }

  return "";
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isLoopbackRequest(req: NextRequest): boolean {
  const isLoopbackHost = (value: string | null): boolean => {
    const host = (value || "").split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  };

  if (!isLoopbackHost(new URL(req.url).hostname)) return false;
  if (!isLoopbackHost(req.headers.get("host"))) return false;

  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  const candidate = forwardedFor || realIp;

  if (!candidate) return true;
  return candidate === "127.0.0.1" || candidate === "::1" || candidate === "::ffff:127.0.0.1";
}

export function isCronRequest(req: NextRequest): boolean {
  if (!isLoopbackRequest(req)) return false;
  return safeEqual(req.headers.get(HEADER) || "", readCronSecret());
}
