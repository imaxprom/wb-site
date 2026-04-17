/**
 * Sync Source 2: Рекламные расходы (WB Advert API)
 * Независим от других sync-модулей. Маппинг campaign_id→nm_id:
 * 1) свежий из /adverts; 2) fallback на персистентный кеш campaign_nm_map (БД).
 */
import Database from "better-sqlite3";
import { SourceStatus, emptySource, DB_PATH, getApiKey } from "./types";

function ensureCampaignNmTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_nm_map (
      campaign_id INTEGER PRIMARY KEY,
      nm_id INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

async function fetchCampaignNmMap(apiKey: string): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  try {
    const res = await fetch("https://advert-api.wildberries.ru/api/advert/v2/adverts", {
      headers: { Authorization: apiKey },
    });
    if (!res.ok) return map;
    const data = (await res.json()) as { adverts?: { id: number; nm_settings?: { nm_id: number }[] }[] };
    for (const c of data.adverts || []) {
      if (c.nm_settings?.length) {
        map.set(c.id, c.nm_settings[0].nm_id);
      }
    }
  } catch { /* не критично — упадём на кеш */ }
  return map;
}

export async function syncAdvertising(date: string): Promise<SourceStatus> {
  const s: SourceStatus = { ...emptySource(), lastAttempt: new Date().toISOString() };
  const apiKey = getApiKey();
  if (!apiKey) { s.error = "Нет WB API ключа"; return s; }

  try {
    const [updRes, freshNmMap] = await Promise.all([
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
      return s;
    }

    const db = new Database(DB_PATH);
    db.pragma("busy_timeout = 5000");
    ensureCampaignNmTable(db);

    // Upsert свежий маппинг в персистентный кеш
    const upsertMap = db.prepare(`
      INSERT INTO campaign_nm_map (campaign_id, nm_id, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(campaign_id) DO UPDATE SET nm_id=excluded.nm_id, updated_at=excluded.updated_at
    `);
    const now = new Date().toISOString();
    db.transaction(() => {
      for (const [cid, nm] of freshNmMap) upsertMap.run(cid, nm, now);
    })();

    // Читаем кеш (в т.ч. архивные кампании из прошлых синков)
    const cachedRows = db.prepare("SELECT campaign_id, nm_id FROM campaign_nm_map").all() as { campaign_id: number; nm_id: number }[];
    const cachedNmMap = new Map<number, number>(cachedRows.map(r => [r.campaign_id, r.nm_id]));

    const resolveNm = (advertId: number) => freshNmMap.get(advertId) || cachedNmMap.get(advertId) || 0;

    db.prepare("DELETE FROM advertising WHERE date = ?").run(date);
    const ins = db.prepare("INSERT INTO advertising (date, campaign_name, campaign_id, amount, payment_type, nm_id) VALUES (?, ?, ?, ?, ?, ?)");
    db.transaction(() => {
      for (const e of entries) {
        ins.run(date, e.campName || "", e.advertId || 0, e.updSum || 0, e.paymentType || "Баланс", resolveNm(e.advertId || 0));
      }
    })();
    db.close();

    s.ok = true;
    s.value = total;
    const mappedSum = entries.reduce((sum, e) => sum + (resolveNm(e.advertId || 0) ? (e.updSum || 0) : 0), 0);
    const mappedRatio = total > 0 ? mappedSum / total : 0;
    s.stable = mappedRatio >= 0.5;
    if (!s.stable) {
      s.error = `Маппинг nm_id: ${(mappedRatio * 100).toFixed(0)}% — повторю на следующем часу`;
    }
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err);
  }
  return s;
}
