import crypto from "crypto";
import type { PoolClient } from "pg";
import { pgGet, pgQuery, withPgTransaction } from "@/lib/postgres";
import {
  buildCartStockSnapshot,
  getCartStockArticleIdsPg,
  saveCartStockAttempt,
  type CartStockRawProduct,
} from "@/lib/wb-cart-stock";
import type {
  CartStockJobSummary,
  CartStockProductGroup,
  CartStockQueueStatus,
  CartStockSnapshot,
  CartStockWorkerStatus,
} from "@/types/cart-stock";
import {
  getActiveOrganizationId,
  runWithOrganizationContext,
} from "@/lib/organization-context";

const MAX_JOB_ATTEMPTS = 3;
const JOB_LEASE_SECONDS = 180;
const WORKER_ONLINE_SECONDS = 150;

type JobRow = {
  id: number;
  status: "pending" | "processing" | "completed" | "failed";
  source: "manual" | "cron";
  product_group: CartStockProductGroup;
  article_ids: Array<string | number> | string;
  article_count: number;
  attempts: number;
  worker_id: string | null;
  claim_token: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  lease_until: Date | string | null;
  confirmation_json: WarehouseCollapse[] | string | null;
  error: string | null;
};

type WarehouseCollapse = {
  warehouseId: number;
  warehouseName: string;
  previousArticles: number;
  currentArticles: number;
  previousQuantity: number;
  currentQuantity: number;
};

type WorkerRow = {
  worker_id: string;
  last_seen_at: Date | string;
  auth_state: "ok" | "refreshing" | "error" | "unknown";
  bearer_expires_at: Date | string | null;
  last_wb_success_at: Date | string | null;
  last_error: string | null;
  outbox_count: number;
};

export type CartStockClaim = {
  jobId: number;
  claimToken: string;
  articles: string[];
  productGroup: CartStockProductGroup;
  attempt: number;
  leaseUntil: string;
  organizationId?: number;
};

export type AuthorizedCartStockResult = {
  jobId: number;
  claimToken: string;
  status: "success" | "error";
  capturedAt?: string;
  destinationIds?: string[];
  products?: CartStockRawProduct[];
  authenticated?: boolean;
  endpoint?: string;
  bearerExpiresAt?: string | null;
  error?: string;
};

export type CartStockHeartbeat = {
  authState?: "ok" | "refreshing" | "error" | "unknown";
  bearerExpiresAt?: string | null;
  lastWbSuccessAt?: string | null;
  lastError?: string | null;
  outboxCount?: number;
};

const schemaPromises = new Map<number, Promise<void>>();
let lastClaimOrganizationId = 0;

async function verifyProvisionedQueueSchema(organizationId: number): Promise<void> {
  const state = await pgGet<{
    jobs_exists: boolean;
    snapshots_exists: boolean;
    jobs_columns_ready: boolean;
    snapshot_columns_ready: boolean;
  }>(`
    SELECT
      to_regclass('wb_cart_stock_jobs') IS NOT NULL AS jobs_exists,
      to_regclass('wb_cart_stock_snapshots') IS NOT NULL AS snapshots_exists,
      (
        SELECT COUNT(*) = 2
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'wb_cart_stock_jobs'
          AND column_name IN ('product_group', 'confirmation_json')
      ) AS jobs_columns_ready,
      (
        SELECT COUNT(*) = 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'wb_cart_stock_snapshots'
          AND column_name = 'product_group'
      ) AS snapshot_columns_ready
  `);
  if (
    !state?.jobs_exists
    || !state.snapshots_exists
    || !state.jobs_columns_ready
    || !state.snapshot_columns_ready
  ) {
    throw new Error(
      `Organization ${organizationId} cart-stock schema is not provisioned; run the database migration`,
    );
  }
}

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function parseArticles(value: JobRow["article_ids"]): string[] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.map(String).filter((article) => /^\d+$/.test(article));
}

function jobSummary(row: JobRow | undefined): CartStockJobSummary | null {
  if (!row) return null;
  return {
    id: Number(row.id),
    status: row.status,
    source: row.source,
    productGroup: row.product_group || "rucksacks",
    requestedArticles: Number(row.article_count),
    attempts: Number(row.attempts),
    createdAt: iso(row.created_at)!,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    leaseUntil: iso(row.lease_until),
    error: row.error,
  };
}

async function createSchema(): Promise<void> {
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS wb_cart_stock_jobs (
      id BIGSERIAL PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      source TEXT NOT NULL CHECK (source IN ('manual', 'cron')),
      product_group TEXT NOT NULL DEFAULT 'rucksacks' CHECK (product_group IN ('rucksacks', 'underwear')),
      article_ids JSONB NOT NULL,
      article_count INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      worker_id TEXT,
      claim_token TEXT,
      lease_until TIMESTAMPTZ,
      confirmation_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      error TEXT
    )
  `);
  await pgQuery(`
    ALTER TABLE wb_cart_stock_jobs
    ADD COLUMN IF NOT EXISTS product_group TEXT NOT NULL DEFAULT 'rucksacks'
  `);
  await pgQuery(`
    ALTER TABLE wb_cart_stock_jobs
    ADD COLUMN IF NOT EXISTS confirmation_json JSONB
  `);
  await pgQuery(`
    CREATE INDEX IF NOT EXISTS idx_wb_cart_stock_jobs_status_created
    ON wb_cart_stock_jobs (status, created_at, id)
  `);
  await pgQuery(`
    CREATE INDEX IF NOT EXISTS idx_wb_cart_stock_jobs_group_status_created
    ON wb_cart_stock_jobs (product_group, status, created_at, id)
  `);
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS public.wb_cart_stock_worker_state (
      worker_id TEXT PRIMARY KEY,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      auth_state TEXT NOT NULL DEFAULT 'unknown',
      bearer_expires_at TIMESTAMPTZ,
      last_wb_success_at TIMESTAMPTZ,
      last_error TEXT,
      outbox_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS public.wb_cart_stock_worker_nonces (
      nonce TEXT PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgQuery(`
    ALTER TABLE IF EXISTS wb_cart_stock_snapshots
    ADD COLUMN IF NOT EXISTS product_group TEXT NOT NULL DEFAULT 'rucksacks'
  `);
}

export async function ensureCartStockQueueSchema(): Promise<void> {
  const organizationId = getActiveOrganizationId() || 1;
  if (!schemaPromises.has(organizationId)) {
    // Organization schemas are provisioned by the privileged migration
    // function. Runtime workers only verify them: attempting even
    // CREATE TABLE IF NOT EXISTS requires CREATE on the schema and must never
    // be part of normal queue polling.
    const promise = (organizationId === 1
      ? createSchema()
      : verifyProvisionedQueueSchema(organizationId)
    ).catch((error) => {
      schemaPromises.delete(organizationId);
      throw error;
    });
    schemaPromises.set(organizationId, promise);
  }
  return schemaPromises.get(organizationId)!;
}

async function activeOrganizationIds(): Promise<number[]> {
  const result = await pgQuery<{ id: number }>(`
    SELECT id FROM public.organizations WHERE status = 'active' ORDER BY id
  `);
  return result.rows.map((row) => Number(row.id)).filter((id) => Number.isSafeInteger(id) && id > 0);
}

function workerOrganizationContext(organizationId: number) {
  return {
    organizationId,
    userId: null,
    organizationRole: "owner" as const,
    source: "job" as const,
  };
}

async function selectJob(client: PoolClient, id: number): Promise<JobRow | undefined> {
  const result = await client.query<JobRow>(
    `SELECT * FROM wb_cart_stock_jobs WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return result.rows[0];
}

export async function enqueueCartStockJob(
  source: "manual" | "cron",
  productGroup: CartStockProductGroup = "rucksacks",
): Promise<CartStockJobSummary> {
  await ensureCartStockQueueSchema();
  const articles = await getCartStockArticleIdsPg(productGroup);

  return withPgTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [774820260802]);
    const active = await client.query<JobRow>(`
      SELECT *
      FROM wb_cart_stock_jobs
      WHERE status IN ('pending', 'processing')
        AND product_group = $1
      ORDER BY created_at, id
      LIMIT 1
      FOR UPDATE
    `, [productGroup]);
    if (active.rows[0]) return jobSummary(active.rows[0])!;

    const inserted = await client.query<JobRow>(`
      INSERT INTO wb_cart_stock_jobs (status, source, product_group, article_ids, article_count)
      VALUES ('pending', $1, $2, $3::jsonb, $4)
      RETURNING *
    `, [source, productGroup, JSON.stringify(articles), articles.length]);
    return jobSummary(inserted.rows[0])!;
  });
}

export async function enqueueCartStockJobsAcrossOrganizations(
  source: "manual" | "cron",
  productGroups: CartStockProductGroup[],
): Promise<Array<CartStockJobSummary & { organizationId: number }>> {
  const jobs: Array<CartStockJobSummary & { organizationId: number }> = [];
  const failures: Array<{ organizationId: number; productGroup: CartStockProductGroup; error: string }> = [];
  for (const organizationId of await activeOrganizationIds()) {
    for (const productGroup of productGroups) {
      try {
        const job = await runWithOrganizationContext(
          workerOrganizationContext(organizationId),
          () => enqueueCartStockJob(source, productGroup),
        );
        jobs.push({ ...job, organizationId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ organizationId, productGroup, error: message });
        console.error(
          `[cart-stock-jobs] Queue creation skipped organization ${organizationId} group ${productGroup}: ${message}`,
        );
      }
    }
  }
  if (jobs.length === 0 && failures.length > 0) {
    throw new Error(
      `Cart-stock jobs could not be queued: ${failures.map((item) => `${item.organizationId}/${item.productGroup} (${item.error})`).join(', ')}`,
    );
  }
  return jobs;
}

export async function claimCartStockJob(workerId: string): Promise<CartStockClaim | null> {
  await ensureCartStockQueueSchema();

  return withPgTransaction(async (client) => {
    await client.query(`
      UPDATE wb_cart_stock_jobs
      SET status = 'failed', completed_at = NOW(), updated_at = NOW(),
          error = COALESCE(error, 'Worker lease expired after maximum attempts')
      WHERE status = 'processing'
        AND lease_until < NOW()
        AND attempts >= $1
    `, [MAX_JOB_ATTEMPTS]);
    await client.query(`
      UPDATE wb_cart_stock_jobs
      SET status = 'pending', worker_id = NULL, claim_token = NULL,
          lease_until = NULL, updated_at = NOW(),
          error = COALESCE(error, 'Worker lease expired; job returned to queue')
      WHERE status = 'processing'
        AND lease_until < NOW()
        AND attempts < $1
    `, [MAX_JOB_ATTEMPTS]);

    const claimToken = crypto.randomUUID();
    const result = await client.query<JobRow>(`
      WITH candidate AS (
        SELECT id
        FROM wb_cart_stock_jobs
        WHERE status = 'pending' AND attempts < $1
        ORDER BY created_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE wb_cart_stock_jobs AS jobs
      SET status = 'processing', worker_id = $2, claim_token = $3,
          attempts = jobs.attempts + 1,
          started_at = COALESCE(jobs.started_at, NOW()),
          lease_until = NOW() + ($4 * INTERVAL '1 second'),
          updated_at = NOW(), error = NULL
      FROM candidate
      WHERE jobs.id = candidate.id
      RETURNING jobs.*
    `, [MAX_JOB_ATTEMPTS, workerId, claimToken, JOB_LEASE_SECONDS]);

    const row = result.rows[0];
    if (!row) return null;
    return {
      jobId: Number(row.id),
      claimToken,
      articles: parseArticles(row.article_ids),
      productGroup: row.product_group || "rucksacks",
      attempt: Number(row.attempts),
      leaseUntil: iso(row.lease_until)!,
    };
  });
}

export async function claimCartStockJobAcrossOrganizations(workerId: string): Promise<CartStockClaim | null> {
  const organizationIds = await activeOrganizationIds();
  if (organizationIds.length === 0) return null;
  const start = Math.max(0, organizationIds.findIndex((id) => id > lastClaimOrganizationId));
  const ordered = [...organizationIds.slice(start), ...organizationIds.slice(0, start)];
  const failures: Array<{ organizationId: number; error: string }> = [];
  for (const organizationId of ordered) {
    try {
      const claim = await runWithOrganizationContext(
        workerOrganizationContext(organizationId),
        () => claimCartStockJob(workerId),
      );
      if (claim) {
        lastClaimOrganizationId = organizationId;
        return { ...claim, organizationId };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ organizationId, error: message });
      console.error(`[cart-stock-jobs] Skipping unavailable organization ${organizationId}: ${message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Cart-stock queue unavailable for organizations: ${failures.map((item) => `${item.organizationId} (${item.error})`).join(', ')}`,
    );
  }
  return null;
}

function validateAuthorizedResult(
  articles: string[],
  result: AuthorizedCartStockResult,
): asserts result is AuthorizedCartStockResult & {
  products: CartStockRawProduct[];
  capturedAt: string;
  destinationIds: string[];
} {
  if (result.status !== "success") throw new Error(result.error || "Worker returned an error");
  if (result.authenticated !== true) throw new Error("Worker result is not authenticated");
  if (result.endpoint !== "/__internal/card/cards/v4/detail") {
    throw new Error("Worker used an unexpected WB endpoint");
  }
  if (!result.capturedAt || !Number.isFinite(Date.parse(result.capturedAt))) {
    throw new Error("Worker result has an invalid capturedAt value");
  }
  if (!Array.isArray(result.destinationIds) || result.destinationIds.length === 0) {
    throw new Error("Worker result has no WB destination");
  }
  if (!Array.isArray(result.products)) throw new Error("Worker result has no products array");

  const expected = new Set(articles);
  const returned = new Set(result.products.map((product) => String(product.articleWB)));
  const missingRows = articles.filter((article) => !returned.has(article));
  const unexpected = Array.from(returned).filter((article) => !expected.has(article));
  if (missingRows.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Worker result article mismatch: missing=${missingRows.length}, unexpected=${unexpected.length}`,
    );
  }
}

function validateSnapshotShape(current: CartStockSnapshot): void {
  if (current.returnedArticles !== current.requestedArticles) {
    throw new Error(
      `Incomplete WB card response: returned ${current.returnedArticles}/${current.requestedArticles} articles`,
    );
  }
  if (current.warehouses.length === 0 || current.totalCartQuantity <= 0) {
    throw new Error("Authenticated WB card response contains no explicit warehouse stock");
  }
}

function findWarehouseCollapses(
  previous: CartStockSnapshot | null,
  current: CartStockSnapshot,
): WarehouseCollapse[] {
  if (!previous || previous.source !== "wb-authorized-card") return [];

  const currentWarehouses = new Map(current.warehouses.map((warehouse) => [warehouse.id, warehouse]));
  const collapses: WarehouseCollapse[] = [];
  for (const oldWarehouse of previous.warehouses) {
    const next = currentWarehouses.get(oldWarehouse.id);
    const nextArticles = next?.articles || 0;
    const nextQuantity = next?.quantity || 0;
    if (
      oldWarehouse.articles >= 5
      && oldWarehouse.quantity >= 20
      && nextArticles < Math.ceil(oldWarehouse.articles * 0.5)
      && nextQuantity < oldWarehouse.quantity * 0.5
    ) {
      collapses.push({
        warehouseId: oldWarehouse.id,
        warehouseName: oldWarehouse.name,
        previousArticles: oldWarehouse.articles,
        currentArticles: nextArticles,
        previousQuantity: oldWarehouse.quantity,
        currentQuantity: nextQuantity,
      });
    }
  }
  return collapses;
}

function parseConfirmation(value: JobRow["confirmation_json"]): WarehouseCollapse[] {
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
    return Array.isArray(parsed) ? parsed as WarehouseCollapse[] : [];
  } catch {
    return [];
  }
}

function collapseMessage(collapses: WarehouseCollapse[]): string {
  return collapses.map((collapse) =>
    `${collapse.warehouseName}: ${collapse.previousArticles}→${collapse.currentArticles} арт., `
    + `${collapse.previousQuantity}→${collapse.currentQuantity} шт.`,
  ).join("; ");
}

function confirmsPreviousCollapse(
  previousConfirmation: WarehouseCollapse[],
  currentCollapses: WarehouseCollapse[],
): boolean {
  if (previousConfirmation.length === 0 || currentCollapses.length === 0) return false;
  const previousIds = new Set(previousConfirmation.map((collapse) => collapse.warehouseId));
  const currentIds = new Set(currentCollapses.map((collapse) => collapse.warehouseId));
  return previousIds.size === currentIds.size
    && Array.from(previousIds).every((warehouseId) => currentIds.has(warehouseId));
}

async function latestAuthorizedSnapshot(productGroup: CartStockProductGroup): Promise<CartStockSnapshot | null> {
  // The snapshot table migration is also executed by status/save paths before
  // production jobs complete. Keep the group predicate here so one product
  // family can never trip the completeness guard for the other.
  const row = await pgGet<{ payload_json: CartStockSnapshot | string | null }>(`
    SELECT payload_json
    FROM wb_cart_stock_snapshots
    WHERE status = 'success'
      AND payload_json->>'source' = 'wb-authorized-card'
      AND product_group = $1
    ORDER BY captured_at DESC, id DESC
    LIMIT 1
  `, [productGroup]).catch(() => undefined);
  if (!row?.payload_json) return null;
  if (typeof row.payload_json === "string") {
    try { return JSON.parse(row.payload_json) as CartStockSnapshot; } catch { return null; }
  }
  return row.payload_json;
}

export async function finishCartStockJob(
  workerId: string,
  result: AuthorizedCartStockResult,
): Promise<{ status: "completed" | "requeued" | "failed"; snapshot?: CartStockSnapshot }> {
  await ensureCartStockQueueSchema();

  const job = await pgGet<JobRow>(`
    SELECT * FROM wb_cart_stock_jobs WHERE id = ?
  `, [result.jobId]);
  if (!job) throw new Error("Cart stock job not found");
  if (job.status === "completed" && result.status === "success") return { status: "completed" };
  if (job.status !== "processing" || job.worker_id !== workerId || job.claim_token !== result.claimToken) {
    throw new Error("Cart stock job claim is stale or belongs to another worker");
  }

  if (result.status === "error") {
    const message = (result.error || "Worker failed to collect WB cart stock").slice(0, 2000);
    const terminal = Number(job.attempts) >= MAX_JOB_ATTEMPTS;
    await pgQuery(`
      UPDATE wb_cart_stock_jobs
      SET status = $1, worker_id = NULL, claim_token = NULL, lease_until = NULL,
          completed_at = CASE WHEN $1 = 'failed' THEN NOW() ELSE NULL END,
          updated_at = NOW(), error = $2
      WHERE id = $3 AND claim_token = $4
    `, [terminal ? "failed" : "pending", message, result.jobId, result.claimToken]);
    await saveCartStockAttempt(null, message, job.product_group || "rucksacks");
    return { status: terminal ? "failed" : "requeued" };
  }

  const articles = parseArticles(job.article_ids);
  const productGroup = job.product_group || "rucksacks";
  validateAuthorizedResult(articles, result);
  const snapshot = await buildCartStockSnapshot(articles, result.products, {
    productGroup,
    source: "wb-authorized-card",
    authenticated: true,
    destinationIds: result.destinationIds,
    checkedLocations: ["авторизованная покупательская сессия WB"],
    failedLocations: [],
    destinationLabel: "авторизованная карточка пользовательского сайта WB",
    capturedAt: result.capturedAt,
  });
  validateSnapshotShape(snapshot);
  const previousSnapshot = await latestAuthorizedSnapshot(productGroup);
  const collapses = findWarehouseCollapses(previousSnapshot, snapshot);
  const previousConfirmation = parseConfirmation(job.confirmation_json);

  if (collapses.length > 0 && !confirmsPreviousCollapse(previousConfirmation, collapses)) {
    const message = `Подтверждаем резкое изменение складов повторным запросом WB: ${collapseMessage(collapses)}`;
    if (Number(job.attempts) >= MAX_JOB_ATTEMPTS) {
      await pgQuery(`
        UPDATE wb_cart_stock_jobs
        SET status = 'failed', worker_id = NULL, claim_token = NULL, lease_until = NULL,
            completed_at = NOW(), updated_at = NOW(), error = $1
        WHERE id = $2 AND claim_token = $3
      `, [message, result.jobId, result.claimToken]);
      await saveCartStockAttempt(null, message, productGroup);
      return { status: "failed" };
    }
    await pgQuery(`
      UPDATE wb_cart_stock_jobs
      SET status = 'pending', worker_id = NULL, claim_token = NULL, lease_until = NULL,
          updated_at = NOW(), error = $1, confirmation_json = $2::jsonb
      WHERE id = $3 AND claim_token = $4
    `, [message, JSON.stringify(collapses), result.jobId, result.claimToken]);
    return { status: "requeued" };
  }

  await saveCartStockAttempt(snapshot, null);

  const update = await pgQuery(`
    UPDATE wb_cart_stock_jobs
    SET status = 'completed', completed_at = NOW(), updated_at = NOW(),
        lease_until = NULL, confirmation_json = NULL, error = NULL
    WHERE id = $1 AND status = 'processing' AND worker_id = $2 AND claim_token = $3
  `, [result.jobId, workerId, result.claimToken]);
  if (update.rowCount !== 1) throw new Error("Cart stock job changed while saving the result");
  return { status: "completed", snapshot };
}

export async function finishCartStockJobAcrossOrganizations(
  workerId: string,
  result: AuthorizedCartStockResult,
): Promise<{ status: "completed" | "requeued" | "failed"; snapshot?: CartStockSnapshot }> {
  const failures: Array<{ organizationId: number; error: string }> = [];
  for (const organizationId of await activeOrganizationIds()) {
    let matchingJob: { claim_token: string | null } | undefined;
    try {
      matchingJob = await runWithOrganizationContext(
        workerOrganizationContext(organizationId),
        () => pgGet<{ claim_token: string | null }>(
          "SELECT claim_token FROM wb_cart_stock_jobs WHERE id = ?",
          [result.jobId],
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ organizationId, error: message });
      console.error(`[cart-stock-jobs] Result lookup skipped organization ${organizationId}: ${message}`);
      continue;
    }
    if (matchingJob?.claim_token !== result.claimToken) continue;
    return runWithOrganizationContext(
      workerOrganizationContext(organizationId),
      () => finishCartStockJob(workerId, result),
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `Cart-stock result lookup failed for organizations: ${failures.map((item) => `${item.organizationId} (${item.error})`).join(', ')}`,
    );
  }
  throw new Error("Cart stock job not found");
}

export async function updateCartStockWorker(
  workerId: string,
  heartbeat: CartStockHeartbeat,
): Promise<void> {
  await ensureCartStockQueueSchema();
  await pgQuery(`
    INSERT INTO public.wb_cart_stock_worker_state (
      worker_id, last_seen_at, auth_state, bearer_expires_at,
      last_wb_success_at, last_error, outbox_count
    ) VALUES ($1, NOW(), $2, $3, $4, $5, $6)
    ON CONFLICT (worker_id) DO UPDATE SET
      last_seen_at = NOW(), auth_state = EXCLUDED.auth_state,
      bearer_expires_at = EXCLUDED.bearer_expires_at,
      last_wb_success_at = EXCLUDED.last_wb_success_at,
      last_error = EXCLUDED.last_error, outbox_count = EXCLUDED.outbox_count
  `, [
    workerId,
    heartbeat.authState || "unknown",
    heartbeat.bearerExpiresAt || null,
    heartbeat.lastWbSuccessAt || null,
    heartbeat.lastError?.slice(0, 2000) || null,
    Math.max(0, Number(heartbeat.outboxCount) || 0),
  ]);
}

export async function registerCartStockWorkerNonce(nonce: string): Promise<boolean> {
  await ensureCartStockQueueSchema();
  await pgQuery(`DELETE FROM public.wb_cart_stock_worker_nonces WHERE received_at < NOW() - INTERVAL '10 minutes'`);
  const result = await pgQuery(`
    INSERT INTO public.wb_cart_stock_worker_nonces (nonce)
    VALUES ($1)
    ON CONFLICT DO NOTHING
  `, [nonce]);
  return result.rowCount === 1;
}

export async function getCartStockQueueStatus(
  productGroup: CartStockProductGroup = "rucksacks",
): Promise<CartStockQueueStatus> {
  await ensureCartStockQueueSchema();
  const [active, latest, worker] = await Promise.all([
    pgGet<JobRow>(`
      SELECT * FROM wb_cart_stock_jobs
      WHERE status IN ('pending', 'processing')
        AND product_group = $1
      ORDER BY created_at, id LIMIT 1
    `, [productGroup]),
    pgGet<JobRow>(`
      SELECT * FROM wb_cart_stock_jobs
      WHERE product_group = $1
      ORDER BY created_at DESC, id DESC LIMIT 1
    `, [productGroup]),
    pgGet<WorkerRow>(`
      SELECT * FROM public.wb_cart_stock_worker_state
      ORDER BY last_seen_at DESC LIMIT 1
    `),
  ]);

  let workerStatus: CartStockWorkerStatus | null = null;
  if (worker) {
    const lastSeenAt = iso(worker.last_seen_at)!;
    workerStatus = {
      workerId: worker.worker_id,
      online: Date.now() - Date.parse(lastSeenAt) <= WORKER_ONLINE_SECONDS * 1000,
      lastSeenAt,
      authState: worker.auth_state,
      bearerExpiresAt: iso(worker.bearer_expires_at),
      lastWbSuccessAt: iso(worker.last_wb_success_at),
      lastError: worker.last_error,
      outboxCount: Number(worker.outbox_count) || 0,
    };
  }

  return {
    active: jobSummary(active),
    latest: jobSummary(latest),
    worker: workerStatus,
  };
}
