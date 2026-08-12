import pg, { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { getActiveOrganizationId, getOrganizationSchemaName } from "@/lib/organization-context";

const { types } = pg;

// Keep runtime JSON stable: PostgreSQL int8/numeric values should arrive as JS
// numbers for our aggregate API responses.
types.setTypeParser(20, (value) => Number(value)); // int8
types.setTypeParser(1700, (value) => Number(value)); // numeric

let pool: Pool | null = null;

export function isPostgresEnabled(): boolean {
  return true;
}

export function isPostgresReadonlyConnection(): boolean {
  return Boolean(process.env.DATABASE_URL?.includes("mphub_readonly"));
}

export function getPostgresPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for MpHub PostgreSQL runtime");
    }
    if (process.env.MPHUB_DB_ENGINE && process.env.MPHUB_DB_ENGINE !== "postgres") {
      throw new Error(`Unsupported MPHUB_DB_ENGINE=${process.env.MPHUB_DB_ENGINE}; MpHub runtime is PostgreSQL-only`);
    }
    pool = new Pool({
      connectionString,
      max: Number(process.env.PGPOOL_MAX || 20),
      idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.PGPOOL_CONNECTION_TIMEOUT_MS || 5000),
      application_name: process.env.PGAPPNAME || "mphub",
    });
  }
  return pool;
}

export async function pgQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  const organizationId = getActiveOrganizationId();
  if (!organizationId) {
    return getPostgresPool().query<T>(sql, params);
  }

  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    await setClientOrganizationContext(client, organizationId);
    const result = await client.query<T>(sql, params);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function positionalParamsToPg(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

export async function pgRows<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await pgQuery<T>(positionalParamsToPg(sql), params);
  return result.rows;
}

export async function pgGet<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const result = await pgQuery<T>(positionalParamsToPg(sql), params);
  return result.rows[0];
}

export async function withPgClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withPgTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      const organizationId = getActiveOrganizationId();
      if (organizationId) await setClientOrganizationContext(client, organizationId);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function setClientOrganizationContext(client: PoolClient, organizationId: number): Promise<void> {
  const schemaName = getOrganizationSchemaName(organizationId);
  await client.query("SELECT set_config('app.current_organization_id', $1, true)", [String(organizationId)]);
  await client.query("SELECT set_config('search_path', $1, true)", [`${schemaName},pg_catalog`]);
}
