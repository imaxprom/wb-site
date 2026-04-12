/**
 * Sync Source 2: Рекламные расходы (WB Advert API)
 * Независим от других sync-модулей.
 */
import Database from "better-sqlite3";
import { SourceStatus, emptySource, DB_PATH, getApiKey } from "./types";

async function getCampaignNmMap(apiKey: string): Promise<Map<number, number>> {
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
  } catch { /* не критично — nm_id будет 0 */ }
  return map;
}

export async function syncAdvertising(date: string): Promise<SourceStatus> {
  const s: SourceStatus = { ...emptySource(), lastAttempt: new Date().toISOString() };
  const apiKey = getApiKey();
  if (!apiKey) { s.error = "Нет WB API ключа"; return s; }

  try {
    const [updRes, nmMap] = await Promise.all([
      fetch(`https://advert-api.wildberries.ru/adv/v1/upd?from=${date}&to=${date}`, {
        headers: { Authorization: apiKey },
      }),
      getCampaignNmMap(apiKey),
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
    db.prepare("DELETE FROM advertising WHERE date = ?").run(date);
    const ins = db.prepare("INSERT INTO advertising (date, campaign_name, campaign_id, amount, payment_type, nm_id) VALUES (?, ?, ?, ?, ?, ?)");
    db.transaction(() => {
      for (const e of entries) {
        const nmId = nmMap.get(e.advertId || 0) || 0;
        ins.run(date, e.campName || "", e.advertId || 0, e.updSum || 0, e.paymentType || "Баланс", nmId);
      }
    })();
    db.close();

    s.ok = true;
    s.value = total;
    // Если маппинг campaign→nm_id не сработал — не помечаем stable, чтобы синк повторился
    const mappedCount = entries.filter(e => nmMap.get(e.advertId || 0)).length;
    s.stable = mappedCount > 0;
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err);
  }
  return s;
}
