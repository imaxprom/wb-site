/**
 * Shared API utilities — consistent response format and error handling.
 */

import { NextResponse } from "next/server";

/** Standard success response */
export function apiOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

/** Standard paginated response */
export function apiPage<T>(data: T[], total: number, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data, total }, { status });
}

/** Standard error response */
export function apiError(err: unknown, status = 500): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (status >= 500) {
    console.error("[API Error]", err);
  }
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** Validate date string format YYYY-MM-DD */
export function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

/** Validate and clamp pagination params */
export function parsePagination(
  page: string | null,
  perPage: string | null,
  maxPerPage = 500
): { page: number; perPage: number; offset: number } {
  const p = Math.max(1, parseInt(page || "1", 10) || 1);
  const pp = Math.min(maxPerPage, Math.max(1, parseInt(perPage || "25", 10) || 25));
  return { page: p, perPage: pp, offset: (p - 1) * pp };
}
