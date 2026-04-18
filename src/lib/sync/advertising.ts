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

    const db = new Database(DB_PATH);
    db.pragma("busy_timeout = 5000");
    ensureCampaignNmTable(db);

    const upsertMap = db.prepare(`
      INSERT INTO campaign_nm_map (campaign_id, nm_id, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(campaign_id) DO UPDATE SET nm_id=excluded.nm_id, updated_at=excluded.updated_at
    `);
    const now = new Date().toISOString();
    db.transaction(() => {
      for (const [cid, nm] of adverts.map) upsertMap.run(cid, nm, now);
    })();

    const cachedRows = db.prepare("SELECT campaign_id, nm_id FROM campaign_nm_map").all() as { campaign_id: number; nm_id: number }[];
    const cachedNmMap = new Map<number, number>(cachedRows.map(r => [r.campaign_id, r.nm_id]));

    const resolveNm = (advertId: number) => adverts.map.get(advertId) || cachedNmMap.get(advertId) || 0;

    // Idempotency: сверяем с тем, что уже лежит в БД.
    // Если сумма и кол-во записей совпадают — не трогаем.
    const existingStats = db.prepare(
      "SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as sum FROM advertising WHERE date = ?"
    ).get(date) as { cnt: number; sum: number };
    const unchanged =
      existingStats.cnt === entries.length &&
      Math.abs(existingStats.sum - total) < 0.01;

    if (!unchanged) {
      db.prepare("DELETE FROM advertising WHERE date = ?").run(date);
      const ins = db.prepare("INSERT INTO advertising (date, campaign_name, campaign_id, amount, payment_type, nm_id) VALUES (?, ?, ?, ?, ?, ?)");
      db.transaction(() => {
        for (const e of entries) {
          ins.run(date, e.campName || "", e.advertId || 0, e.updSum || 0, e.paymentType || "Баланс", resolveNm(e.advertId || 0));
        }
      })();
    }
    db.close();

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
