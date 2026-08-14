function metaValues(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function normalizedMetaType(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function canonicalMetaType(value: string): string {
  const normalized = normalizedMetaType(value);
  if (normalized === "customsdeclaration") return "customsDeclaration";
  return normalized;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isCustomsDeclaration(value: string): boolean {
  return normalizedMetaType(value) === "customsdeclaration";
}

function isIdentificationMark(value: string): boolean {
  return normalizedMetaType(value) === "sgtin";
}

function productText(productName: unknown, vendorCode: unknown): string {
  return `${typeof productName === "string" ? productName : ""} ${typeof vendorCode === "string" ? vendorCode : ""}`
    .trim()
    .toLocaleLowerCase("ru-RU");
}

// Fail-safe business rule for the assortment currently handled by MpHub.
// WB may omit requiredMeta/optionalMeta from some history responses, but
// underwear still must never bypass Honest Mark/DataMatrix processing.
export function isFbsInternallyMarkedProduct(productName: unknown, vendorCode: unknown = ""): boolean {
  const value = productText(productName, vendorCode);
  return /(?:^|[^а-яё])трус(?:ы|ов|ики|иков|ам|ами|ах)?(?:[^а-яё]|$)/iu.test(value)
    || /(?:^|[^а-яё])нижн(?:ее|его|ему|ем)\s+бель[еёяю](?:[^а-яё]|$)/iu.test(value);
}

export type FbsLiveMeta = {
  availableMeta?: unknown;
  filled?: unknown;
  meta?: unknown;
  metaDetails?: unknown;
};

export type FbsLiveMetaState = {
  state: "filled" | "pending" | "missing" | "rejected";
  decision: string;
  values: string[];
  authoritative: boolean;
};

export type FbsMarkingPolicy = {
  forceUnderwearSgtin: boolean;
};

export const DEFAULT_FBS_MARKING_POLICY: FbsMarkingPolicy = {
  forceUnderwearSgtin: true,
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasValue(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.some(hasValue);
  const row = objectValue(value);
  if (!row) return false;
  if ("value" in row) return hasValue(row.value);
  if ("values" in row) return hasValue(row.values);
  if ("sgtins" in row) return hasValue(row.sgtins);
  return false;
}

function detailMetaType(value: unknown): string {
  const row = objectValue(value);
  if (!row) return "";
  const raw = row.key ?? row.type ?? row.name ?? row.metaType;
  return typeof raw === "string" ? canonicalMetaType(raw) : "";
}

function flattenedValues(value: unknown): string[] {
  if (typeof value === "string" && value.length > 0) return [value];
  if (Array.isArray(value)) return value.flatMap(flattenedValues);
  const row = objectValue(value);
  if (!row) return [];
  if ("value" in row) return flattenedValues(row.value);
  if ("values" in row) return flattenedValues(row.values);
  if ("sgtins" in row) return flattenedValues(row.sgtins);
  return [];
}

function normalizedDecision(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

const SUCCESSFUL_META_DECISIONS = new Set([
  "filled",
  "sgtinintroduced",
  "sgtinsoldb2b",
  "imeimaysell",
  "imeisoldb2b",
]);

const PENDING_META_DECISIONS = new Set([
  "pending",
]);

export function getFbsLiveAvailableMeta(meta: FbsLiveMeta | null | undefined): string[] {
  if (!meta) return [];
  const values: string[] = [];
  if (Array.isArray(meta.availableMeta)) values.push(...meta.availableMeta.map(String));
  const stored = objectValue(meta.meta);
  if (stored) values.push(...Object.keys(stored));
  if (Array.isArray(meta.metaDetails)) {
    for (const detail of meta.metaDetails) {
      const type = detailMetaType(detail);
      if (type) values.push(type);
    }
  }
  return unique(values.map(canonicalMetaType).filter(Boolean));
}

export function isFbsLiveMetaFilled(meta: FbsLiveMeta | null | undefined, type: string): boolean {
  return getFbsLiveMetaState(meta, type).state === "filled";
}

export function getFbsLiveMetaState(meta: FbsLiveMeta | null | undefined, type: string): FbsLiveMetaState {
  const empty: FbsLiveMetaState = { state: "missing", decision: "", values: [], authoritative: false };
  if (!meta) return empty;
  const canonical = canonicalMetaType(type);

  // metaDetails is WB's current validation result and is authoritative. A
  // deprecated value in meta must never override pending or rejection here.
  if (Array.isArray(meta.metaDetails)) {
    const details = meta.metaDetails.filter((detail) => detailMetaType(detail) === canonical);
    if (details.length) {
      const values = details.flatMap((detail) => flattenedValues(objectValue(detail)?.value));
      const decisions = details.map((detail) => {
        const row = objectValue(detail);
        return normalizedDecision(row?.decision ?? row?.status);
      }).filter(Boolean);
      const successfulDecision = decisions.find((decision) => SUCCESSFUL_META_DECISIONS.has(decision));
      if (successfulDecision || (!decisions.length && values.length > 0)) {
        return { state: "filled", decision: successfulDecision || "filled", values, authoritative: true };
      }
      const pendingDecision = decisions.find((decision) => PENDING_META_DECISIONS.has(decision));
      if (pendingDecision) {
        return { state: "pending", decision: pendingDecision, values, authoritative: true };
      }
      const decision = decisions.find((item) => !["required", "optional", "missing", "empty"].includes(item)) || decisions[0] || "";
      return {
        state: decision && !["required", "optional", "missing", "empty"].includes(decision) ? "rejected" : "missing",
        decision,
        values,
        authoritative: true,
      };
    }
  }

  const filled = objectValue(meta.filled);
  if (filled) {
    for (const [key, value] of Object.entries(filled)) {
      if (canonicalMetaType(key) === canonical && hasValue(value)) {
        return { state: "filled", decision: "filled", values: flattenedValues(value), authoritative: true };
      }
    }
  }
  const stored = objectValue(meta.meta);
  if (stored) {
    for (const [key, value] of Object.entries(stored)) {
      if (canonicalMetaType(key) === canonical && hasValue(value)) {
        return { state: "filled", decision: "filled", values: flattenedValues(value), authoritative: false };
      }
    }
  }
  return empty;
}

export function getFbsSafeMetaDecisions(meta: FbsLiveMeta | null | undefined): Array<{ type: string; decision: string }> {
  return getFbsLiveAvailableMeta(meta).map((type) => {
    const state = getFbsLiveMetaState(meta, type);
    return {
      type,
      decision: state.state === "filled" ? "filled" : state.state === "rejected" ? state.decision || "rejected" : state.state,
    };
  });
}

// WB returns customsDeclaration in optionalMeta for ordinary products as an
// available field. It must not send such products to the operator's marking
// step. SGTIN is different: for products subject to mandatory identification
// marking it must be captured even when WB puts it in optionalMeta.
export function getFbsEffectiveRequiredMeta(
  requiredMeta: unknown,
  optionalMeta: unknown,
  productName: unknown = "",
  vendorCode: unknown = "",
  liveAvailableMeta: unknown = [],
  markingPolicy: FbsMarkingPolicy = DEFAULT_FBS_MARKING_POLICY,
): string[] {
  // WB's requiredMeta always has priority. Optional/available SGTIN is only
  // promoted to mandatory by the legal entity's explicit strict policy.
  const values = metaValues(requiredMeta).map(canonicalMetaType).filter(Boolean);
  if (markingPolicy.forceUnderwearSgtin) {
    values.push(...metaValues(optionalMeta).filter(isIdentificationMark).map(canonicalMetaType));
    values.push(...metaValues(liveAvailableMeta).filter(isIdentificationMark).map(canonicalMetaType));
    if (isFbsInternallyMarkedProduct(productName, vendorCode)) values.push("sgtin");
  }
  return unique(values);
}

export function getFbsReviewOptionalMeta(optionalMeta: unknown): string[] {
  return unique(metaValues(optionalMeta).filter((value) => !isCustomsDeclaration(value) && !isIdentificationMark(value)));
}

export function hasFbsOperatorMetadata(
  requiredMeta: unknown,
  optionalMeta: unknown,
  productName: unknown = "",
  vendorCode: unknown = "",
  markingPolicy: FbsMarkingPolicy = DEFAULT_FBS_MARKING_POLICY,
): boolean {
  return getFbsEffectiveRequiredMeta(requiredMeta, optionalMeta, productName, vendorCode, [], markingPolicy).length > 0
    || getFbsReviewOptionalMeta(optionalMeta).length > 0;
}
