/**
 * Sync Source 2: Рекламные расходы (WB Advert API)
 * Независим от других sync-модулей. Маппинг campaign_id→nm_id:
 * 1) свежий из /adverts; 2) fallback на персистентный кеш campaign_nm_map (БД).
 */
import { SourceStatus, emptySource, getApiKey } from "./types";
import { pgGet, pgRows, withPgTransaction } from "@/lib/postgres";

async function ensureCampaignNmTablePg(): Promise<void> {
  await withPgTransaction(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS campaign_nm_map (
        campaign_id BIGINT PRIMARY KEY,
        nm_id BIGINT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  });
}

async function fetchCampaignNmMap(apiKey: string): Promise<{ ok: boolean; map: Map<number, number> }> {
  const map = new Map<number, number>();
  try {
    const res = await fetch("https://advert-api.wildberries.ru/api/advert/v2/adverts", {
      headers: { Authorization: apiKey },
    });
    if (!res.ok) return { ok: false, map };
    const data = (await res.json()) as { adverts?: { id: number; nm_settings?: { nm_id: number }[] }[] };
    for (const c of data.adverts || []) {
      if (c.nm_settings?.length) {
        map.set(c.id, c.nm_settings[0].nm_id);
      }
    }
    return { ok: true, map };
  } catch { return { ok: false, map }; }
}

export async function syncAdvertising(date: string, prevValue = 0): Promise<SourceStatus> {
  const s: SourceStatus = { ...emptySource(), prevValue, lastAttempt: new Date().toISOString() };
  const apiKey = getApiKey();
  if (!apiKey) { s.error = "Нет WB API ключа"; return s; }

  try {
    const [updRes, adverts] = await Promise.all([
      fetch(`https://advert-api.wildberries.ru/adv/v1/upd?from=${date}&to=${date}`, {
        headers: { Authorization: apiKey },
      }),
      fetchCampaignNmMap(apiKey),
    ]);
    if (!updRes.ok) { s.error = `API error: ${updRes.status}`; return s; }

    const data = (await updRes.json()) as { updSum?: number; campName?: string; advertId?: number; paymentType?: string; updTime?: string }[];

    const entries = data.filter(d => (d.updSum || 0) > 0);
    const total = entries.reduce((sum, d) => sum + (d.updSum || 0), 0);

    if (total === 0) {
      s.error = "Нет рекламных расходов за эту дату";
      s.stable = adverts.ok;
      return s;
    }

    const now = new Date().toISOString();
    let cachedRows: { campaign_id: number; nm_id: number }[] = [];
    await ensureCampaignNmTablePg();
    await withPgTransaction(async (client) => {
      for (const [cid, nm] of adverts.map) {
        await client.query(`
          INSERT INTO campaign_nm_map (campaign_id, nm_id, updated_at) VALUES ($1, $2, $3)
          ON CONFLICT(campaign_id) DO UPDATE SET nm_id=EXCLUDED.nm_id, updated_at=EXCLUDED.updated_at
        `, [cid, nm, now]);
      }
    });
    cachedRows = await pgRows<{ campaign_id: number; nm_id: number }>(
      "SELECT campaign_id, nm_id FROM campaign_nm_map"
    );

    const cachedNmMap = new Map<number, number>(cachedRows.map(r => [r.campaign_id, r.nm_id]));

    const resolveNm = (advertId: number) => adverts.map.get(advertId) || cachedNmMap.get(advertId) || 0;

    // Idempotency: сверяем с тем, что уже лежит в БД.
    // Если сумма и кол-во записей совпадают — не трогаем.
    const existingStats = await pgGet<{ cnt: number; sum: number }>(
      "SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as sum FROM advertising WHERE date = ?",
      [date]
    ) || { cnt: 0, sum: 0 };
    const unchanged =
      existingStats.cnt === entries.length &&
      Math.abs(existingStats.sum - total) < 0.01;

    if (!unchanged) {
      await withPgTransaction(async (client) => {
        await client.query("DELETE FROM advertising WHERE date = $1", [date]);
        for (const e of entries) {
          await client.query(
            "INSERT INTO advertising (date, campaign_name, campaign_id, amount, payment_type, nm_id) VALUES ($1, $2, $3, $4, $5, $6)",
            [date, e.campName || "", e.advertId || 0, e.updSum || 0, e.paymentType || "Баланс", resolveNm(e.advertId || 0)]
          );
        }
      });
    }

    s.ok = true;
    s.value = total;
    // stable=true только когда сумма совпала с предыдущим запуском.
    // WB публикует "финальный добор" за сутки (updTime=23:59:59) уже после
    // полуночи — одного успешного фетча недостаточно, нужна пара совпавших.
    s.stable = prevValue > 0 && Math.abs(total - prevValue) < 0.01;
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err);
  }
  return s;
}
