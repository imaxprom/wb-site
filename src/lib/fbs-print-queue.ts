import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { fbsStickerNumber } from "@/lib/fbs-label";
import { getActiveOrganizationId } from "@/lib/organization-context";
import { pgRows, withPgTransaction } from "@/lib/postgres";
import { getFbsBoxStickers, getFbsOrderStickers, getFbsSupplyBarcode, getFbsSupplyBoxes, type FbsWbSticker } from "@/lib/fbs-wb-api";

type BatchOrder = {
  order_id: number;
  supply_id: string | null;
  nm_id: number;
  chrt_id: number;
  product_name: string;
  size_name: string;
  skus: string[];
  supplier_status: string;
  picked_at: string | null;
  sticker_printed_at: string | null;
};

export type FbsPrintJob = {
  job_id: string;
  supply_id: string;
  group_key: string;
  nm_id: number;
  chrt_id: number;
  sku: string;
  product_name: string;
  size_name: string;
  total_count: number;
  printed_count: number;
  status: "queued" | "printing" | "paused" | "completed" | "cancelled" | "error";
  agent_id: string | null;
  last_error: string;
  created_at: string;
  updated_at: string;
};

export async function getFbsPrintAgentSnapshot() {
  const agents = await pgRows<{ agent_id: string; name: string; printer_name: string; status: string; last_error: string; last_seen_at: string | null }>(`
    SELECT agent_id,name,printer_name,
      CASE WHEN last_seen_at<CURRENT_TIMESTAMP-INTERVAL '45 seconds' THEN 'offline' ELSE status END AS status,
      last_error,last_seen_at
    FROM fbs_print_agents
    WHERE enabled=TRUE
    ORDER BY created_at DESC
  `);
  return { printAgents: agents };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function safeGroupKey(nmId: number, chrtId: number, sku: string) {
  return `${nmId}:${chrtId}:${sku}`;
}

function looksLikeRawZpl(value: string): boolean {
  const start = value.trimStart().slice(0, 128);
  return start.startsWith("^XA") || start.startsWith("~DG") || start.includes("^XA");
}

// WB returns PNG stickers as Base64, while ZPL stickers may arrive as raw
// printer commands. The print-agent contract is Base64 for every format, so
// normalize raw ZPL here before it enters the persistent queue.
function stickerFileForPrintAgent(file: string, format: string): string {
  if (!format.startsWith("zpl")) return file;
  if (looksLikeRawZpl(file)) return Buffer.from(file, "utf8").toString("base64");
  try {
    const decoded = Buffer.from(file, "base64").toString("utf8");
    if (looksLikeRawZpl(decoded)) return file;
  } catch {
    // The explicit error below is safer than creating a permanently broken
    // print job that can only fail on the warehouse computer.
  }
  throw new Error("WB вернул повреждённую ZPL-этикетку");
}

function wbStickerNumber(sticker: FbsWbSticker): string {
  const partA = String(sticker.partA ?? "").trim();
  const partB = String(sticker.partB ?? "").trim();
  return `${partA}${partB}`;
}

async function recordEvent(client: PoolClient, supplyId: string, action: string, message: string, details: unknown = {}) {
  await client.query(`INSERT INTO fbs_fulfillment_events (supply_id,action,status,message,details_json) VALUES ($1,$2,'ok',$3,$4::jsonb)`, [supplyId, action, message, JSON.stringify(details)]);
}

export async function getFbsPrintQueueSnapshot(supplyId = "") {
  await withPgTransaction(async (client) => {
    const expired = await client.query<{ job_id: string }>(`
      UPDATE fbs_print_job_items
      SET status='uncertain',lease_until=NULL
      WHERE status='printing' AND lease_until<CURRENT_TIMESTAMP
      RETURNING job_id
    `);
    const jobIds = Array.from(new Set(expired.rows.map((row) => row.job_id)));
    if (jobIds.length) {
      await client.query(`
        UPDATE fbs_print_jobs
        SET status='paused',last_error='Связь с программой печати прервалась. Подтвердите последнюю напечатанную этикетку.',updated_at=CURRENT_TIMESTAMP
        WHERE job_id=ANY($1::text[]) AND status='printing'
      `, [jobIds]);
    }
  });
  const [jobs, agents] = await Promise.all([
    supplyId
      ? pgRows<FbsPrintJob>(`
          SELECT job_id,supply_id,group_key,nm_id,chrt_id,sku,product_name,size_name,
            total_count,printed_count,status,agent_id,last_error,created_at,updated_at
          FROM fbs_print_jobs
          WHERE supply_id=?
            AND (status IN ('queued','printing','paused') OR group_key LIKE 'single:%')
          ORDER BY created_at DESC
          LIMIT 250
        `, [supplyId])
      : pgRows<FbsPrintJob>(`SELECT job_id,supply_id,group_key,nm_id,chrt_id,sku,product_name,size_name,total_count,printed_count,status,agent_id,last_error,created_at,updated_at FROM fbs_print_jobs WHERE created_at>=CURRENT_TIMESTAMP-INTERVAL '7 days' ORDER BY created_at DESC LIMIT 200`),
    getFbsPrintAgentSnapshot().then((snapshot) => snapshot.printAgents),
  ]);
  return { printJobs: jobs, printAgents: agents };
}

export async function createFbsTestPrintJob() {
  const agents = await pgRows<{ agent_id: string }>(`SELECT agent_id FROM fbs_print_agents WHERE enabled=TRUE ORDER BY last_seen_at DESC NULLS LAST LIMIT 1`);
  if (!agents[0]) throw new Error("Сначала настройте принтер");
  const jobId = crypto.randomUUID();
  const groupKey = `test:${jobId}`;
  const zpl = [
    "^XA",
    // The test label is sent as RAW ZPL and therefore bypasses Windows driver
    // preferences. Set the requested Zebra darkness explicitly and persist it
    // so subsequent jobs and printer restarts use the same value.
    "~SD30",
    "^JUS",
    "^PW464",
    "^LL320",
    "^LH0,0",
    "^FO34,28^A0N,54,54^FDTEST FBS^FS",
    "^FO34,98^A0N,28,28^FDPrinter is ready^FS",
    `^FO34,142^A0N,24,24^FD${new Date().toISOString().slice(0, 19).replace("T", " ")}^FS`,
    "^FO34,190^GB396,2,2^FS",
    "^FO34,218^A0N,24,24^FDDo not attach to an order^FS",
    "^XZ",
  ].join("\n");
  await withPgTransaction(async (client) => {
    await client.query(`
      INSERT INTO fbs_print_jobs (
        job_id,supply_id,group_key,nm_id,chrt_id,sku,product_name,size_name,total_count
      ) VALUES ($1,'__test__',$2,0,0,'TEST','Тестовая этикетка','',1)
    `, [jobId, groupKey]);
    await client.query(`
      INSERT INTO fbs_print_job_items (
        job_id,position,order_id,sticker_barcode,sticker_file,sticker_format
      ) VALUES ($1,1,0,'TEST',$2,'zpl')
    `, [jobId, Buffer.from(zpl, "utf8").toString("base64")]);
    await recordEvent(client, "__test__", "test_print_created", "Тестовая этикетка передана на Zebra", { jobId });
  });
  return (await pgRows<FbsPrintJob>(`SELECT * FROM fbs_print_jobs WHERE job_id=?`, [jobId]))[0];
}

export async function createFbsPrinterSupportRequest(details: Record<string, unknown> = {}) {
  const code = `PRN-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${crypto.randomInt(1000, 10000)}`;
  const agents = await pgRows<{ agent_id: string; printer_name: string; status: string; last_error: string; last_seen_at: string | null }>(`
    SELECT agent_id,printer_name,status,last_error,last_seen_at
    FROM fbs_print_agents WHERE enabled=TRUE ORDER BY last_seen_at DESC NULLS LAST LIMIT 5
  `);
  await withPgTransaction(async (client) => {
    await client.query(`
      INSERT INTO fbs_fulfillment_events (action,status,message,details_json)
      VALUES ('printer_support_requested','error',$1,$2::jsonb)
    `, [`Запрос помощи по принтеру ${code}`, JSON.stringify({ code, agents, ...details })]);
  });
  return { code };
}

export async function createFbsBatchPrintJob(input: { supplyId: string; nmId: number; chrtId: number; sku: string; quantity?: number }) {
  const supplyId = input.supplyId.trim();
  const nmId = Number(input.nmId);
  const chrtId = Number(input.chrtId);
  const sku = input.sku.trim();
  if (!supplyId || !Number.isSafeInteger(nmId) || !Number.isSafeInteger(chrtId) || !sku) throw new Error("Некорректная группа товара");
  const groupKey = safeGroupKey(nmId, chrtId, sku);
  const existing = await pgRows<FbsPrintJob>(`SELECT * FROM fbs_print_jobs WHERE supply_id=? AND group_key=? AND status IN ('queued','printing','paused') ORDER BY created_at DESC LIMIT 1`, [supplyId, groupKey]);
  if (existing[0]) return existing[0];

  const rows = await pgRows<BatchOrder>(`SELECT order_id,supply_id,nm_id,chrt_id,product_name,size_name,skus,supplier_status,picked_at FROM fbs_fulfillment_orders WHERE supply_id=? AND nm_id=? AND chrt_id=? AND supplier_status='confirm' AND picked_at IS NULL ORDER BY created_at_wb,order_id`, [supplyId, nmId, chrtId]);
  const eligible = rows.filter((row) => strings(row.skus).includes(sku));
  if (!eligible.length) throw new Error("В этой группе нет несобранных заказов");
  const requested = Number(input.quantity || eligible.length);
  const quantity = Math.min(eligible.length, Number.isSafeInteger(requested) && requested > 0 ? requested : eligible.length);
  const selected = eligible.slice(0, quantity);
  const orderIds = selected.map((row) => Number(row.order_id));
  // Use WB's rendered 58x40 PNG through the installed Windows Zebra driver.
  // The native ZPL layout does not respect this warehouse's calibrated media
  // positioning and can place the barcode outside the printable area.
  const stickerFormat = "png";
  const stickers = await getFbsOrderStickers(orderIds, stickerFormat, 58);
  if (stickers.length !== orderIds.length) throw new Error(`WB вернул ${stickers.length} этикеток вместо ${orderIds.length}`);
  const stickerMap = new Map(stickers.map((row, index) => [Number(row.orderId || orderIds[index]), row]));
  const jobId = crypto.randomUUID();

  await withPgTransaction(async (client) => {
    await client.query(`INSERT INTO fbs_print_jobs (job_id,supply_id,group_key,nm_id,chrt_id,sku,product_name,size_name,total_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [jobId, supplyId, groupKey, nmId, chrtId, sku, selected[0].product_name || "", selected[0].size_name || "", orderIds.length]);
    for (let index = 0; index < orderIds.length; index += 1) {
      const sticker = stickerMap.get(orderIds[index]);
      if (!sticker?.file) throw new Error("WB не вернул файл одной из этикеток");
      const stickerNumber = wbStickerNumber(sticker);
      if (!stickerNumber) throw new Error("WB не вернул номер одной из этикеток");
      await client.query(`INSERT INTO fbs_print_job_items (job_id,position,order_id,sticker_barcode,sticker_file,sticker_format) VALUES ($1,$2,$3,$4,$5,$6)`, [jobId, index + 1, orderIds[index], sticker.barcode || "", stickerFileForPrintAgent(sticker.file, stickerFormat), stickerFormat]);
      await client.query(`UPDATE fbs_fulfillment_orders SET raw_json=jsonb_set(COALESCE(raw_json,'{}'::jsonb),'{_mphubStickerNumber}',to_jsonb($2::text),TRUE),updated_at=CURRENT_TIMESTAMP WHERE order_id=$1`, [orderIds[index], stickerNumber]);
    }
    await recordEvent(client, supplyId, "batch_print_created", `Создана очередь на ${orderIds.length} этикеток`, { jobId, groupKey, orderIds });
  });
  return (await pgRows<FbsPrintJob>(`SELECT * FROM fbs_print_jobs WHERE job_id=?`, [jobId]))[0];
}

export async function createFbsSinglePrintJob(orderIdInput: number) {
  const orderId = Number(orderIdInput);
  if (!Number.isSafeInteger(orderId) || orderId < 1) throw new Error("Не удалось определить выбранную этикетку");
  const rows = await pgRows<BatchOrder>(`
    SELECT order_id,supply_id,nm_id,chrt_id,product_name,size_name,skus,
      supplier_status,picked_at,sticker_printed_at
    FROM fbs_fulfillment_orders WHERE order_id=? LIMIT 1
  `, [orderId]);
  const order = rows[0];
  if (!order?.supply_id) throw new Error("Этикетка не найдена в рабочей поставке");
  if (order.supplier_status !== "confirm") throw new Error("Этикетку можно печатать только на этапе сборки");
  const supplyId = order.supply_id;
  const groupRows = await pgRows<BatchOrder>(`
    SELECT order_id,supply_id,nm_id,chrt_id,product_name,size_name,skus,
      supplier_status,picked_at,sticker_printed_at
    FROM fbs_fulfillment_orders
    WHERE supply_id=? AND nm_id=? AND chrt_id=? AND supplier_status='confirm'
  `, [supplyId, order.nm_id, order.chrt_id]);
  const sku = strings(order.skus)[0] || "";
  const group = groupRows.filter((row) => strings(row.skus).includes(sku));
  if (!group.length || group.some((row) => !row.picked_at || !row.sticker_printed_at)) {
    throw new Error("Отдельная печать доступна только после завершения общей печати всех этикеток товара");
  }
  const activeJobs = await pgRows<{ job_id: string }>(`
    SELECT j.job_id FROM fbs_print_jobs j
    JOIN fbs_print_job_items i ON i.job_id=j.job_id
    WHERE i.order_id=? AND j.status IN ('queued','printing','paused')
    ORDER BY j.created_at DESC LIMIT 1
  `, [orderId]);
  if (activeJobs[0]) throw new Error("Эта этикетка уже передана на печать");

  const stickerFormat = "png";
  const stickers = await getFbsOrderStickers([orderId], stickerFormat, 58);
  const sticker = stickers[0];
  if (!sticker?.file) throw new Error("WB не вернул файл этикетки");
  const stickerNumber = wbStickerNumber(sticker);
  if (!stickerNumber) throw new Error("WB не вернул номер этикетки");
  const jobId = crypto.randomUUID();
  const groupKey = `single:${orderId}:${jobId}`;
  const reprint = true;

  await withPgTransaction(async (client) => {
    await client.query(`
      INSERT INTO fbs_print_jobs (
        job_id,supply_id,group_key,nm_id,chrt_id,sku,product_name,size_name,total_count
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1)
    `, [jobId, supplyId, groupKey, order.nm_id, order.chrt_id, sku, order.product_name || "", order.size_name || ""]);
    await client.query(`
      INSERT INTO fbs_print_job_items (
        job_id,position,order_id,sticker_barcode,sticker_file,sticker_format
      ) VALUES ($1,1,$2,$3,$4,$5)
    `, [jobId, orderId, sticker.barcode || "", stickerFileForPrintAgent(sticker.file, stickerFormat), stickerFormat]);
    await client.query(`UPDATE fbs_fulfillment_orders SET raw_json=jsonb_set(COALESCE(raw_json,'{}'::jsonb),'{_mphubStickerNumber}',to_jsonb($2::text),TRUE),updated_at=CURRENT_TIMESTAMP WHERE order_id=$1`, [orderId, stickerNumber]);
    await recordEvent(
      client,
      supplyId,
      reprint ? "single_label_reprint_created" : "single_label_print_created",
      `${reprint ? "Повторная печать" : "Печать"} этикетки ${stickerNumber}`,
      { jobId, orderId, reprint },
    );
  });
  return { job_id: jobId, order_id: orderId, sticker_number: stickerNumber, total_count: 1, reprint };
}

export async function createFbsBatchReprintJob(orderIdsInput: number[]) {
  const orderIds = Array.from(new Set(orderIdsInput.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)));
  if (orderIds.length === 0 || orderIds.length > 500) throw new Error("Некорректный список этикеток для повторной печати");
  const organizationId = getActiveOrganizationId() || 0;
  return withPgTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`fbs-batch-reprint:${organizationId}:${orderIds.slice().sort((a, b) => a - b).join(",")}`]);
    const result = await client.query<BatchOrder>(`
      SELECT order_id,supply_id,nm_id,chrt_id,product_name,size_name,skus,
        supplier_status,picked_at,sticker_printed_at
      FROM fbs_fulfillment_orders
      WHERE order_id=ANY($1::bigint[])
      ORDER BY created_at_wb,order_id
      FOR UPDATE
    `, [orderIds]);
    if (result.rows.length !== orderIds.length) throw new Error("Часть этикеток не найдена в рабочей поставке");
    const selected = result.rows;
    const first = selected[0];
    if (!first.supply_id || selected.some((order) => order.supply_id !== first.supply_id || order.nm_id !== first.nm_id || order.chrt_id !== first.chrt_id)) {
      throw new Error("Повторно печатать все можно только внутри одной пачки товара");
    }
    const sku = strings(first.skus)[0] || "";
    if (!sku || selected.some((order) => !strings(order.skus).includes(sku))) throw new Error("Этикетки относятся к разным товарам");
    if (selected.some((order) => order.supplier_status !== "confirm")) throw new Error("Повторная печать доступна только на этапе сборки");
    if (selected.some((order) => !order.picked_at || !order.sticker_printed_at)) {
      throw new Error("Повторная печать всей пачки доступна после завершения первоначальной печати");
    }
    const active = await client.query<{ job_id: string }>(`
      SELECT DISTINCT j.job_id
      FROM fbs_print_jobs j
      JOIN fbs_print_job_items i ON i.job_id=j.job_id
      WHERE i.order_id=ANY($1::bigint[]) AND j.status IN ('queued','printing','paused')
      LIMIT 1
    `, [orderIds]);
    if (active.rows[0]) throw new Error("Одна из этикеток этой пачки уже находится в очереди печати");

    const source = await client.query<{
      order_id: number;
      sticker_barcode: string;
      sticker_file: string;
      sticker_format: string;
    }>(`
      SELECT DISTINCT ON (i.order_id)
        i.order_id,i.sticker_barcode,i.sticker_file,i.sticker_format
      FROM fbs_print_job_items i
      JOIN fbs_print_jobs j ON j.job_id=i.job_id
      WHERE i.order_id=ANY($1::bigint[]) AND i.status='printed'
      ORDER BY i.order_id,i.printed_at DESC NULLS LAST,j.created_at DESC
    `, [orderIds]);
    if (source.rows.length !== orderIds.length) throw new Error("Не удалось найти сохранённые файлы всех ранее напечатанных этикеток");
    const sourceByOrder = new Map(source.rows.map((item) => [Number(item.order_id), item]));
    const jobId = crypto.randomUUID();
    const groupKey = `batch-reprint:${safeGroupKey(Number(first.nm_id), Number(first.chrt_id), sku)}:${jobId}`;
    await client.query(`
      INSERT INTO fbs_print_jobs (
        job_id,supply_id,group_key,nm_id,chrt_id,sku,product_name,size_name,total_count
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [jobId, first.supply_id, groupKey, first.nm_id, first.chrt_id, sku, first.product_name || "", first.size_name || "", selected.length]);
    for (let index = 0; index < selected.length; index += 1) {
      const item = sourceByOrder.get(Number(selected[index].order_id));
      if (!item?.sticker_file) throw new Error("Сохранённый файл одной из этикеток повреждён");
      await client.query(`
        INSERT INTO fbs_print_job_items (
          job_id,position,order_id,sticker_barcode,sticker_file,sticker_format
        ) VALUES ($1,$2,$3,$4,$5,$6)
      `, [jobId, index + 1, selected[index].order_id, item.sticker_barcode || "", item.sticker_file, item.sticker_format]);
    }
    await recordEvent(client, first.supply_id, "batch_label_reprint_created", `Повторная печать всей пачки: ${selected.length} этикеток`, { jobId, groupKey, orderIds });
    return (await client.query<FbsPrintJob>(`SELECT * FROM fbs_print_jobs WHERE job_id=$1`, [jobId])).rows[0];
  });
}

export async function createFbsSupplyQrPrintJob(supplyIdInput: string) {
  const supplyId = supplyIdInput.trim();
  if (!supplyId) throw new Error("Не выбрана поставка");
  const groupKey = `supply-qr:${supplyId}`;
  const organizationId = getActiveOrganizationId() || 0;
  return withPgTransaction(async (client) => {
    // Serialize requests for the same organization and supply. This makes a
    // double click or a repeated request after a browser reload idempotent.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`fbs-supply-qr:${organizationId}:${supplyId}`]);
    const supplies = await client.query<{ done: boolean }>(`SELECT done FROM fbs_fulfillment_supplies WHERE supply_id=$1 LIMIT 1`, [supplyId]);
    if (!supplies.rows[0]) throw new Error("Поставка не найдена");
    if (!supplies.rows[0].done) throw new Error("QR поставки доступен после передачи в доставку");

    const existing = await client.query<FbsPrintJob>(`
      SELECT * FROM fbs_print_jobs
      WHERE supply_id=$1 AND group_key=$2 AND status IN ('queued','printing','paused','completed')
      ORDER BY created_at DESC LIMIT 1
    `, [supplyId, groupKey]);
    if (existing.rows[0]) return existing.rows[0];

    const sticker = await getFbsSupplyBarcode(supplyId, "png");
    if (!sticker?.file) throw new Error("WB не вернул QR-код поставки");
    const jobId = crypto.randomUUID();
    await client.query(`INSERT INTO fbs_print_jobs (job_id,supply_id,group_key,nm_id,chrt_id,sku,product_name,size_name,total_count) VALUES ($1,$2,$3,0,0,$2,'QR поставки','',1)`, [jobId, supplyId, groupKey]);
    await client.query(`INSERT INTO fbs_print_job_items (job_id,position,order_id,sticker_barcode,sticker_file,sticker_format) VALUES ($1,1,0,$2,$3,'png')`, [jobId, sticker.barcode || supplyId, sticker.file]);
    await recordEvent(client, supplyId, "supply_qr_print_created", "QR поставки передан на печать", { jobId });
    return (await client.query<FbsPrintJob>(`SELECT * FROM fbs_print_jobs WHERE job_id=$1`, [jobId])).rows[0];
  });
}

async function createFbsBoxQrJob(supplyIdInput: string, requestedBoxId = "") {
  const supplyId = supplyIdInput.trim();
  if (!supplyId) throw new Error("Не выбрана поставка");
  const organizationId = getActiveOrganizationId() || 0;
  return withPgTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`fbs-box-qr:${organizationId}:${supplyId}`]);
    const supplies = await client.query<{ delivery_mode: string; done: boolean; box_stickers_printed_ids: string[] }>(`
      SELECT delivery_mode,done,box_stickers_printed_ids FROM fbs_fulfillment_supplies WHERE supply_id=$1 LIMIT 1
    `, [supplyId]);
    if (!supplies.rows[0]) throw new Error("Поставка не найдена");
    if (supplies.rows[0].done) throw new Error("Поставка уже передана в доставку");
    if (supplies.rows[0].delivery_mode !== "pvz") throw new Error("QR грузомест нужен только для поставки в ПВЗ");

    const liveIds = await getFbsSupplyBoxes(supplyId);
    if (!liveIds.length) throw new Error("Сначала создайте грузоместа");
    if (requestedBoxId && !liveIds.includes(requestedBoxId)) throw new Error("Грузоместо больше не существует на WB");
    const alreadyPrinted = new Set(strings(supplies.rows[0].box_stickers_printed_ids));
    const boxIds = requestedBoxId ? [requestedBoxId] : liveIds.filter((id) => !alreadyPrinted.has(id));
    const fingerprint = crypto.createHash("sha256").update(liveIds.join("\n")).digest("hex").slice(0, 16);
    const groupKey = requestedBoxId
      ? `box-qr-reprint:${supplyId}:${requestedBoxId}:${crypto.randomUUID()}`
      : `box-qr:${supplyId}:${fingerprint}`;
    if (!requestedBoxId) {
      const existing = await client.query<FbsPrintJob>(`
        SELECT * FROM fbs_print_jobs
        WHERE supply_id=$1 AND group_key=$2 AND status IN ('queued','printing','paused')
        ORDER BY created_at DESC LIMIT 1
      `, [supplyId, groupKey]);
      if (existing.rows[0]) return existing.rows[0];
      if (!boxIds.length) throw new Error("Все QR грузомест уже напечатаны. Для повтора выберите одно грузоместо");
    }

    const stickers = await getFbsBoxStickers(supplyId, boxIds, "png");
    if (stickers.length !== boxIds.length) throw new Error(`WB вернул ${stickers.length} QR вместо ${boxIds.length}`);
    const jobId = crypto.randomUUID();
    await client.query(`
      INSERT INTO fbs_print_jobs (job_id,supply_id,group_key,nm_id,chrt_id,sku,product_name,size_name,total_count)
      VALUES ($1,$2,$3,0,0,$2,$4,'',$5)
    `, [jobId, supplyId, groupKey, requestedBoxId ? `Повтор QR грузоместа ${requestedBoxId}` : "QR грузомест ПВЗ", boxIds.length]);
    for (let index = 0; index < boxIds.length; index += 1) {
      const sticker = stickers[index];
      if (!sticker?.file) throw new Error(`WB не вернул QR грузоместа ${boxIds[index]}`);
      await client.query(`
        INSERT INTO fbs_print_job_items (
          job_id,position,order_id,sticker_barcode,sticker_file,sticker_format,reference_id
        ) VALUES ($1,$2,$3,$4,$5,'png',$6)
      `, [jobId, index + 1, -(index + 1), sticker.barcode || boxIds[index], sticker.file, boxIds[index]]);
    }
    await client.query(`UPDATE fbs_fulfillment_supplies SET boxes_count=$2,box_ids=$3::jsonb,updated_at=CURRENT_TIMESTAMP WHERE supply_id=$1`, [supplyId, liveIds.length, JSON.stringify(liveIds)]);
    await recordEvent(client, supplyId, requestedBoxId ? "box_qr_reprint_created" : "box_qr_print_created", requestedBoxId ? `QR ${requestedBoxId} передан на повторную печать` : `${boxIds.length} QR грузомест передано на печать`, { jobId, boxIds });
    return (await client.query<FbsPrintJob>(`SELECT * FROM fbs_print_jobs WHERE job_id=$1`, [jobId])).rows[0];
  });
}

export async function createFbsBoxQrPrintJob(supplyId: string) {
  return createFbsBoxQrJob(supplyId);
}

export async function createFbsSingleBoxQrPrintJob(supplyId: string, boxId: string) {
  const normalizedBoxId = boxId.trim();
  if (!normalizedBoxId) throw new Error("Выберите грузоместо");
  return createFbsBoxQrJob(supplyId, normalizedBoxId);
}

export async function createFbsPrintAgent(name = "FBS print-agent") {
  const organizationId = getActiveOrganizationId();
  if (!organizationId) throw new Error("Не выбрано юрлицо");
  const agentId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString("hex");
  const token = `mphub-print-${organizationId}-${secret}`;
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  await withPgTransaction(async (client) => {
    await client.query(`INSERT INTO fbs_print_agents (agent_id,name,token_hash) VALUES ($1,$2,$3)`, [agentId, name.trim().slice(0, 100) || "FBS print-agent", hash]);
  });
  return { agentId, token };
}

export function parseFbsPrintAgentOrganization(token: string): number | null {
  const match = /^mphub-print-(\d+)-[a-f0-9]{64}$/.exec(token);
  const organizationId = Number(match?.[1] || 0);
  return Number.isSafeInteger(organizationId) && organizationId > 0 ? organizationId : null;
}

export async function authenticateFbsPrintAgent(token: string) {
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const rows = await pgRows<{ agent_id: string }>(`SELECT agent_id FROM fbs_print_agents WHERE token_hash=? AND enabled=TRUE LIMIT 1`, [hash]);
  if (!rows[0]) throw new Error("Print-agent не авторизован");
  return rows[0].agent_id;
}

export async function heartbeatFbsPrintAgent(agentId: string, printerName: string, status = "online", error = "") {
  await withPgTransaction(async (client) => {
    await client.query(`UPDATE fbs_print_agents SET printer_name=$2,status=$3,last_error=$4,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE agent_id=$1`, [agentId, printerName.slice(0, 200), status.slice(0, 30), error.slice(0, 1000)]);
  });
}

export async function claimFbsPrintItem(agentId: string, printerName: string) {
  return withPgTransaction(async (client) => {
    await client.query(`UPDATE fbs_print_agents SET printer_name=$2,status='online',last_error='',last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE agent_id=$1`, [agentId, printerName.slice(0, 200)]);
    const expired = await client.query<{ job_id: string }>(`
      UPDATE fbs_print_job_items
      SET status='uncertain',lease_until=NULL
      WHERE status='printing' AND lease_until<CURRENT_TIMESTAMP
      RETURNING job_id
    `);
    const expiredJobIds = Array.from(new Set(expired.rows.map((row) => row.job_id)));
    if (expiredJobIds.length) {
      await client.query(`
        UPDATE fbs_print_jobs
        SET status='paused',last_error='Связь с программой печати прервалась. Подтвердите последнюю напечатанную этикетку.',updated_at=CURRENT_TIMESTAMP
        WHERE job_id=ANY($1::text[]) AND status='printing'
      `, [expiredJobIds]);
    }
    const paused = await client.query(`SELECT 1 FROM fbs_print_jobs WHERE status='paused' LIMIT 1`);
    if (paused.rows[0]) return null;
    // A second Windows process may use the same agent token after recovery or
    // logon. Never let it claim the next label while any label is still in
    // flight; printing must remain strictly serial for the whole legal entity.
    const inFlight = await client.query(`
      SELECT 1
      FROM fbs_print_job_items i
      JOIN fbs_print_jobs j ON j.job_id=i.job_id
      WHERE i.status='printing' AND i.lease_until>=CURRENT_TIMESTAMP AND j.status='printing'
      LIMIT 1
    `);
    if (inFlight.rows[0]) return null;
    const result = await client.query<{ job_id: string; position: number; order_id: number; sticker_barcode: string; sticker_file: string; sticker_format: string; total_count: number }>(`
      SELECT i.job_id,i.position,i.order_id,i.sticker_barcode,i.sticker_file,i.sticker_format,j.total_count
      FROM fbs_print_job_items i JOIN fbs_print_jobs j ON j.job_id=i.job_id
      WHERE j.status IN ('queued','printing') AND i.status='pending'
      ORDER BY j.created_at,i.position FOR UPDATE SKIP LOCKED LIMIT 1
    `);
    const item = result.rows[0];
    if (!item) return null;
    await client.query(`UPDATE fbs_print_job_items SET status='printing',lease_until=CURRENT_TIMESTAMP+INTERVAL '5 minutes' WHERE job_id=$1 AND position=$2`, [item.job_id, item.position]);
    await client.query(`UPDATE fbs_print_jobs SET status='printing',agent_id=$2,last_error='',updated_at=CURRENT_TIMESTAMP WHERE job_id=$1`, [item.job_id, agentId]);
    return item;
  });
}

export async function completeFbsPrintItem(agentId: string, jobId: string, position: number) {
  return withPgTransaction(async (client) => {
    const result = await client.query<{ order_id: number; sticker_barcode: string; reference_id: string; item_status: string; supply_id: string; group_key: string; raw_json: Record<string, unknown> | null }>(`SELECT i.order_id,i.sticker_barcode,i.reference_id,i.status AS item_status,j.supply_id,j.group_key,o.raw_json FROM fbs_print_job_items i JOIN fbs_print_jobs j ON j.job_id=i.job_id LEFT JOIN fbs_fulfillment_orders o ON o.order_id=i.order_id WHERE i.job_id=$1 AND i.position=$2 AND j.agent_id=$3 FOR UPDATE OF i,j`, [jobId, position, agentId]);
    const item = result.rows[0];
    if (!item) throw new Error("Элемент очереди не найден");
    const supplyQr = item.group_key.startsWith("supply-qr:");
    const boxQr = item.group_key.startsWith("box-qr:") || item.group_key.startsWith("box-qr-reprint:");
    const testPrint = item.group_key.startsWith("test:");
    if (item.item_status === "printed") {
      const progress = await client.query<{ printed: number; total: number }>(`
        SELECT COUNT(*) FILTER (WHERE i.status='printed')::int AS printed,MAX(j.total_count)::int AS total
        FROM fbs_print_job_items i JOIN fbs_print_jobs j ON j.job_id=i.job_id
        WHERE i.job_id=$1
      `, [jobId]);
      const printed = Number(progress.rows[0]?.printed || 0);
      return { printed, complete: printed === Number(progress.rows[0]?.total || 0) };
    }
    await client.query(`UPDATE fbs_print_job_items SET status='printed',printed_at=CURRENT_TIMESTAMP,lease_until=NULL WHERE job_id=$1 AND position=$2`, [jobId, position]);
    if (!supplyQr && !boxQr && !testPrint) {
      await client.query(`UPDATE fbs_fulfillment_orders SET picked_at=COALESCE(picked_at,CURRENT_TIMESTAMP),sticker_printed_at=COALESCE(sticker_printed_at,CURRENT_TIMESTAMP),sticker_barcode=$2,updated_at=CURRENT_TIMESTAMP WHERE order_id=$1`, [item.order_id, item.sticker_barcode]);
    }
    const count = await client.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM fbs_print_job_items WHERE job_id=$1 AND status='printed'`, [jobId]);
    const total = await client.query<{ total_count: number }>(`SELECT total_count FROM fbs_print_jobs WHERE job_id=$1`, [jobId]);
    const printed = Number(count.rows[0]?.count || 0);
    const complete = printed === Number(total.rows[0]?.total_count || 0);
    await client.query(`UPDATE fbs_print_jobs SET printed_count=$2,status=$3,completed_at=CASE WHEN $3='completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,updated_at=CURRENT_TIMESTAMP WHERE job_id=$1`, [jobId, printed, complete ? "completed" : "printing"]);
    if (boxQr && item.reference_id) {
      const state = await client.query<{ box_stickers_printed_ids: string[] }>(`SELECT box_stickers_printed_ids FROM fbs_fulfillment_supplies WHERE supply_id=$1 FOR UPDATE`, [item.supply_id]);
      const printedIds = Array.from(new Set([...strings(state.rows[0]?.box_stickers_printed_ids), item.reference_id]));
      await client.query(`
        UPDATE fbs_fulfillment_supplies SET
          box_stickers_printed_ids=$2::jsonb,box_stickers_printed_count=$3,
          box_stickers_printed_at=CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE box_stickers_printed_at END,
          updated_at=CURRENT_TIMESTAMP
        WHERE supply_id=$1
      `, [item.supply_id, JSON.stringify(printedIds), printedIds.length, complete]);
    }
    if (complete) {
      if (supplyQr) {
        await client.query(`UPDATE fbs_fulfillment_supplies SET qr_printed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE supply_id=$1`, [item.supply_id]);
        await recordEvent(client, item.supply_id, "supply_qr_print_completed", "QR поставки напечатан", { jobId });
      } else if (boxQr) {
        await recordEvent(client, item.supply_id, item.group_key.startsWith("box-qr-reprint:") ? "box_qr_reprint_completed" : "box_qr_print_completed", item.group_key.startsWith("box-qr-reprint:") ? `QR ${item.reference_id} повторно напечатан` : `Напечатано QR грузомест: ${printed}`, { jobId, boxId: item.reference_id });
      } else if (testPrint) {
        await recordEvent(client, "__test__", "test_print_completed", "Тестовая этикетка напечатана", { jobId });
      } else {
        const single = item.group_key.startsWith("single:");
        const batchReprint = item.group_key.startsWith("batch-reprint:");
        const labelNumber = fbsStickerNumber(item);
        await recordEvent(client, item.supply_id, single ? "single_label_print_completed" : batchReprint ? "batch_label_reprint_completed" : "batch_print_completed", single ? `Напечатана этикетка${labelNumber ? ` ${labelNumber}` : " WB"}` : batchReprint ? `Повторно напечатано ${printed} этикеток` : `Напечатано ${printed} этикеток`, { jobId, orderId: item.order_id });
      }
    }
    return { printed, complete };
  });
}

export async function pauseFbsPrintItem(agentId: string, jobId: string, position: number, error: string) {
  await withPgTransaction(async (client) => {
    await client.query(`UPDATE fbs_print_job_items SET status='uncertain',lease_until=NULL WHERE job_id=$1 AND position=$2 AND status='printing'`, [jobId, position]);
    await client.query(`UPDATE fbs_print_jobs SET status='paused',last_error=$3,updated_at=CURRENT_TIMESTAMP WHERE job_id=$1 AND agent_id=$2`, [jobId, agentId, error.slice(0, 1000)]);
    await client.query(`UPDATE fbs_print_agents SET status='error',last_error=$2,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE agent_id=$1`, [agentId, error.slice(0, 1000)]);
  });
}

export async function resumeFbsPrintJob(jobId: string, lastBarcode = "") {
  await withPgTransaction(async (client) => {
    if (lastBarcode) {
      const marker = await client.query<{ position: number }>(`SELECT position FROM fbs_print_job_items WHERE job_id=$1 AND sticker_barcode=$2`, [jobId, lastBarcode]);
      if (!marker.rows[0]) throw new Error("Этикетка не относится к этой очереди");
      const items = await client.query<{ order_id: number; sticker_barcode: string }>(`SELECT order_id,sticker_barcode FROM fbs_print_job_items WHERE job_id=$1 AND position<=$2 AND status<>'printed'`, [jobId, marker.rows[0].position]);
      for (const item of items.rows) await client.query(`UPDATE fbs_fulfillment_orders SET picked_at=COALESCE(picked_at,CURRENT_TIMESTAMP),sticker_printed_at=COALESCE(sticker_printed_at,CURRENT_TIMESTAMP),sticker_barcode=$2,updated_at=CURRENT_TIMESTAMP WHERE order_id=$1`, [item.order_id, item.sticker_barcode]);
      await client.query(`UPDATE fbs_print_job_items SET status='printed',printed_at=COALESCE(printed_at,CURRENT_TIMESTAMP),lease_until=NULL WHERE job_id=$1 AND position<=$2`, [jobId, marker.rows[0].position]);
    }
    await client.query(`UPDATE fbs_print_job_items SET status='pending',lease_until=NULL WHERE job_id=$1 AND status IN ('printing','uncertain')`, [jobId]);
    const count = await client.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM fbs_print_job_items WHERE job_id=$1 AND status='printed'`, [jobId]);
    const total = await client.query<{ total_count: number }>(`SELECT total_count FROM fbs_print_jobs WHERE job_id=$1`, [jobId]);
    const printed = Number(count.rows[0]?.count || 0);
    const complete = printed === Number(total.rows[0]?.total_count || 0);
    await client.query(`UPDATE fbs_print_jobs SET status=$2,printed_count=$3,last_error='',completed_at=CASE WHEN $2='completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,updated_at=CURRENT_TIMESTAMP WHERE job_id=$1`, [jobId, complete ? "completed" : "queued", printed]);
  });
}
