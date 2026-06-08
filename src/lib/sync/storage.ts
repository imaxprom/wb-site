/**
 * Sync Source 4: Платное хранение (WB Paid Storage API)
 * Независим от других sync-модулей.
 */
import { SourceStatus, emptySource, getApiKey } from "./types";
import { withPgTransaction } from "@/lib/postgres";

export async function syncPaidStorage(date: string): Promise<SourceStatus> {
  const s: SourceStatus = { ...emptySource(), lastAttempt: new Date().toISOString() };
  const apiKey = getApiKey();
  if (!apiKey) { s.error = "Нет WB API ключа"; return s; }

  try {
    const HOST = "https://seller-analytics-api.wildberries.ru";

    const createRes = await fetch(`${HOST}/api/v1/paid_storage?dateFrom=${date}&dateTo=${date}`, {
      headers: { Authorization: apiKey },
    });
    if (!createRes.ok) { s.error = `API create error: ${createRes.status}`; return s; }
    const createData = (await createRes.json()) as { data?: { taskId?: string } };
    const taskId = createData?.data?.taskId;
    if (!taskId) { s.error = "No taskId"; return s; }

    for (let i = 0; i < 15; i++) {
      await new Promise(ok => setTimeout(ok, 2000));
      const statusRes = await fetch(`${HOST}/api/v1/paid_storage/tasks/${taskId}/status`, {
        headers: { Authorization: apiKey },
      });
      const statusData = (await statusRes.json()) as { data?: { status?: string } };
      if (statusData?.data?.status === "done") break;
      if (statusData?.data?.status === "canceled" || statusData?.data?.status === "purged") {
        s.error = "Task " + statusData.data.status;
        return s;
      }
    }

    const dlRes = await fetch(`${HOST}/api/v1/paid_storage/tasks/${taskId}/download`, {
      headers: { Authorization: apiKey },
    });
    if (!dlRes.ok) { s.error = `Download error: ${dlRes.status}`; return s; }
    const raw = await dlRes.json();
    const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);

    if (rows.length === 0) {
      s.error = "Нет данных хранения за эту дату";
      return s;
    }

    let total = 0;
    await withPgTransaction(async (client) => {
      await client.query("DELETE FROM paid_storage WHERE date = $1", [date]);
      for (const r of rows) {
        if ((r.date || date) !== date) continue;
        await client.query(
          "INSERT INTO paid_storage (date, nm_id, barcode, warehouse, warehouse_price, barcodes_count, vendor_code, subject, volume) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
          [date, r.nmId || 0, r.barcode || "", r.warehouse || "", r.warehousePrice || 0, r.barcodesCount || 0, r.vendorCode || "", r.subject || "", r.volume || 0]
        );
        total += r.warehousePrice || 0;
      }
    });
    total = Math.round(total);

    s.ok = true;
    s.value = total;
    s.stable = true;
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err);
  }
  return s;
}
