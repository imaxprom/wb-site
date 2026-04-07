/**
 * Centralized constants — no more magic numbers scattered across codebase.
 */

/** Default cost of goods per unit (RUB) when COGS not set for barcode */
export const DEFAULT_COGS_PER_UNIT = 300;

/** Date ranges for various data queries */
export const DATE_RANGES = {
  /** Default days for order fetch */
  UPLOAD_DAYS: 28,
  /** Stock lookback period */
  STOCK_LOOKBACK_DAYS: 7,
  /** Review enrichment lookback */
  REVIEW_ENRICHMENT_DAYS: 90,
  /** Max days for order history */
  MAX_ORDER_DAYS: 90,
};

/** Trend engine thresholds */
export const TREND = {
  /** Minimum % change to consider a trend "up" or "down" */
  DIRECTION_THRESHOLD: 0.05,
  /** R² thresholds for confidence levels */
  R2_HIGH: 0.7,
  R2_MEDIUM: 0.4,
  /** Multiplier clamp range */
  MULTIPLIER_MIN: 0.1,
  MULTIPLIER_MAX: 3.0,
};

/** Auth & session */
export const AUTH = {
  TOKEN_TTL_DAYS: 30,
  TOKEN_TTL_SECONDS: 30 * 24 * 60 * 60,
};

/** Moscow timezone offset */
export const MSK_OFFSET_HOURS = 3;
