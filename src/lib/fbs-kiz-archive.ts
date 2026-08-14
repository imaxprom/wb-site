import crypto from "node:crypto";
import bwipjs from "bwip-js/node";
import sharp from "sharp";
import { getOrganizationContext } from "@/lib/organization-context";
import { pgRows, withPgTransaction } from "@/lib/postgres";
import { normalizeFbsDataMatrix, parseFbsDataMatrix } from "@/lib/fbs-datamatrix";

export type FbsKizVerificationStatus = "format_verified" | "online_verified" | "error";

type ProductRow = {
  article_wb: string;
  name: string;
  sizes_json: string;
};

type OrderVariantRow = {
  nm_id: number;
  chrt_id: number;
  vendor_code: string;
  product_name: string;
  size_name: string;
  skus: unknown;
};

type ArchiveRow = {
  archive_id: number;
  code_hash: string;
  value_ciphertext: string;
  gtin: string;
  serial_tail: string;
  nm_id: number;
  chrt_id: number;
  vendor_code: string;
  product_name: string;
  size_name: string;
  barcode: string;
  verification_status: FbsKizVerificationStatus;
  verification_source: string;
  verification_message: string;
  scan_count: number;
  print_state: "available" | "reserved" | "printed";
  print_job_id: string | null;
  print_position: number | null;
  reserved_at: string | null;
  printed_at: string | null;
  created_at: string;
  last_checked_at: string;
};

type EventRow = {
  event_id: number;
  archive_id: number | null;
  event_type: "added" | "duplicate" | "error" | "checked" | "print_reserved" | "printed" | "print_recovered";
  code_tail: string;
  nm_id: number | null;
  product_name: string;
  size_name: string;
  verification_status: FbsKizVerificationStatus;
  message: string;
  created_by_user_id: number | null;
  created_at: string;
};

type PrintJobRow = {
  job_id: string;
  nm_id: number;
  sku: string;
  product_name: string;
  size_name: string;
  total_count: number;
  printed_count: number;
  status: FbsKizPrintBatch["status"];
  last_error: string;
  created_at: string;
  updated_at: string;
};

type CatalogVariant = {
  nmId: number;
  chrtId: number;
  vendorCode: string;
  productName: string;
  sizeName: string;
  wbSize: string;
  russianSize: string;
  barcode: string;
};

export type FbsKizArchiveSize = CatalogVariant & {
  total: number;
  available: number;
  reserved: number;
  printed: number;
  onlineVerified: number;
  formatVerified: number;
};

export type FbsKizArchiveProduct = {
  nmId: number;
  vendorCode: string;
  productName: string;
  total: number;
  available: number;
  reserved: number;
  printed: number;
  onlineVerified: number;
  formatVerified: number;
  sizes: FbsKizArchiveSize[];
};

export type FbsKizArchiveEvent = {
  id: number;
  archiveId: number | null;
  eventType: EventRow["event_type"];
  codeTail: string;
  nmId: number | null;
  productName: string;
  sizeName: string;
  wbSize: string;
  russianSize: string;
  verificationStatus: FbsKizVerificationStatus;
  message: string;
  operator: string;
  createdAt: string;
};

export type FbsKizArchiveSnapshot = {
  summary: {
    total: number;
    available: number;
    reserved: number;
    printed: number;
    onlineVerified: number;
    formatVerified: number;
    errors24h: number;
  };
  onlineVerificationConfigured: boolean;
  products: FbsKizArchiveProduct[];
  printBatches: FbsKizPrintBatch[];
  events: FbsKizArchiveEvent[];
};

export type FbsKizPrintBatch = {
  jobId: string;
  nmId: number;
  barcode: string;
  productName: string;
  sizeName: string;
  total: number;
  printed: number;
  status: "queued" | "printing" | "paused" | "completed" | "cancelled" | "error";
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

function hash(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function archiveSecret(): string {
  const configured = process.env.FBS_KIZ_ARCHIVE_KEY?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return "mphub-local-kiz-archive-key-2026";
  throw new Error("FBS_KIZ_ARCHIVE_KEY is required in production");
}

function encryptCode(value: string): string {
  const key = crypto.createHash("sha256").update(archiveSecret(), "utf8").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptCode(value: string): string {
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Зашифрованный КИЗ повреждён");
  const key = crypto.createHash("sha256").update(archiveSecret(), "utf8").digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}

function escapeSvg(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] || character);
}

async function renderKizLabel(value: string, input: { position: number; total: number; nmId: number; sizeName: string; codeTail: string }): Promise<string> {
  const parsed = parseFbsDataMatrix(value);
  const encoded = `^FNC1${parsed.value.replaceAll("\u001d", "^FNC1")}`;
  const matrix = await bwipjs.toBuffer({
    bcid: "datamatrix",
    text: encoded,
    parsefnc: true,
    binarytext: true,
    scale: 5,
    paddingwidth: 4,
    paddingheight: 4,
  });
  const matrixImage = await sharp(matrix)
    .resize(268, 268, { fit: "contain", kernel: sharp.kernel.nearest, background: "white" })
    .png()
    .toBuffer();
  const side = Buffer.from(`<svg width="176" height="320" xmlns="http://www.w3.org/2000/svg">
    <rect width="176" height="320" fill="white"/>
    <text x="8" y="56" font-family="Arial,DejaVu Sans,sans-serif" font-size="42" font-weight="700" fill="black">${input.position}/${input.total}</text>
    <text x="8" y="112" font-family="Arial,DejaVu Sans,sans-serif" font-size="25" font-weight="700" fill="black">WB ${input.nmId}</text>
    <text x="8" y="157" font-family="Arial,DejaVu Sans,sans-serif" font-size="27" font-weight="700" fill="black">${escapeSvg(input.sizeName)}</text>
    <text x="8" y="207" font-family="Arial,DejaVu Sans,sans-serif" font-size="21" fill="black">КИЗ ${escapeSvg(input.codeTail)}</text>
    <text x="8" y="272" font-family="Arial,DejaVu Sans,sans-serif" font-size="18" fill="black">Архив MpHub</text>
  </svg>`, "utf8");
  const label = await sharp({ create: { width: 464, height: 320, channels: 3, background: "white" } })
    .composite([
      { input: matrixImage, left: 8, top: 26 },
      { input: side, left: 288, top: 0 },
    ])
    .png()
    .toBuffer();
  return label.toString("base64");
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function isUnderwear(value: string): boolean {
  return /трус|бель|(?:^|[^a-zа-я])(?:sl|st)[-_]?\d/i.test(value);
}

function visibleBusinessSize(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || normalized === "0") return false;
  const firstNumber = normalized.match(/\d+/)?.[0];
  return !firstNumber || Number(firstNumber) <= 80;
}

function splitSize(value: string): { wbSize: string; russianSize: string } {
  const normalized = value.trim().replace(/–/g, "-");
  const russian = normalized.match(/(\d{2})\s*-\s*(\d{2})/);
  const russianSize = russian ? `${russian[1]}–${russian[2]}` : normalized;
  const explicitWb = normalized.match(/\(([^)]+)\)/)?.[1]?.trim();
  const fallback: Record<string, string> = {
    "40–42": "L",
    "42–44": "XL",
    "44–46": "XXL",
    "46–48": "XXXL",
    "48–50": "3XL",
    "50–52": "4XL",
    "52–54": "5XL",
  };
  return { wbSize: explicitWb || fallback[russianSize] || normalized, russianSize };
}

function sizeOrder(value: string): number {
  return Number(value.match(/\d+/)?.[0] || 999);
}

function codeTail(serial: string): string {
  const compact = serial.replace(/\s+/g, "");
  return compact.length <= 8 ? compact : `…${compact.slice(-8)}`;
}

function normalizedBarcodeCandidates(gtin: string): string[] {
  return Array.from(new Set([gtin, gtin.startsWith("0") ? gtin.slice(1) : ""].filter(Boolean)));
}

async function loadCatalog(): Promise<CatalogVariant[]> {
  const [products, orderVariants] = await Promise.all([
    pgRows<ProductRow>(`SELECT article_wb,name,sizes_json FROM shipment_products WHERE article_wb ~ '^[0-9]+$'`),
    pgRows<OrderVariantRow>(`
      SELECT DISTINCT ON (nm_id,chrt_id)
        nm_id,chrt_id,vendor_code,product_name,size_name,skus
      FROM fbs_fulfillment_orders
      WHERE nm_id > 0 AND chrt_id > 0
      ORDER BY nm_id,chrt_id,updated_at DESC
    `),
  ]);

  const orderByNmBarcode = new Map<string, OrderVariantRow>();
  const orderByBarcode = new Map<string, OrderVariantRow>();
  for (const row of orderVariants) {
    for (const barcode of stringArray(row.skus)) {
      orderByNmBarcode.set(`${Number(row.nm_id)}:${barcode}`, row);
      if (!orderByBarcode.has(barcode)) orderByBarcode.set(barcode, row);
    }
  }

  const variants = new Map<string, CatalogVariant>();
  for (const product of products) {
    const nmId = Number(product.article_wb);
    if (!Number.isSafeInteger(nmId) || nmId <= 0) continue;
    let sizes: Array<{ size?: unknown; barcode?: unknown }> = [];
    try {
      const parsed = JSON.parse(product.sizes_json || "[]");
      if (Array.isArray(parsed)) sizes = parsed;
    } catch {
      continue;
    }
    for (const item of sizes) {
      const barcode = String(item.barcode || "").trim();
      const rawSize = String(item.size || "").trim();
      if (!barcode || !visibleBusinessSize(rawSize)) continue;
      const meta = orderByNmBarcode.get(`${nmId}:${barcode}`) || orderByBarcode.get(barcode);
      const productName = meta?.product_name || product.name;
      const vendorCode = meta?.vendor_code || product.name;
      if (!isUnderwear(`${productName} ${vendorCode} ${product.name}`)) continue;
      const sizeName = meta?.size_name || rawSize;
      const sizes = splitSize(sizeName);
      variants.set(`${nmId}:${barcode}`, {
        nmId,
        chrtId: Number(meta?.chrt_id || 0),
        vendorCode,
        productName,
        sizeName,
        wbSize: sizes.wbSize,
        russianSize: sizes.russianSize,
        barcode,
      });
    }
  }

  for (const row of orderVariants) {
    if (!isUnderwear(`${row.product_name} ${row.vendor_code}`) || !visibleBusinessSize(row.size_name)) continue;
    for (const barcode of stringArray(row.skus)) {
      const key = `${Number(row.nm_id)}:${barcode}`;
      if (variants.has(key)) continue;
      const sizes = splitSize(row.size_name);
      variants.set(key, {
        nmId: Number(row.nm_id),
        chrtId: Number(row.chrt_id),
        vendorCode: row.vendor_code,
        productName: row.product_name,
        sizeName: row.size_name,
        wbSize: sizes.wbSize,
        russianSize: sizes.russianSize,
        barcode,
      });
    }
  }

  return Array.from(variants.values()).sort((left, right) =>
    left.nmId - right.nmId || sizeOrder(left.russianSize) - sizeOrder(right.russianSize) || left.barcode.localeCompare(right.barcode),
  );
}

function findCatalogVariant(catalog: CatalogVariant[], gtin: string): CatalogVariant | null {
  const candidates = new Set(normalizedBarcodeCandidates(gtin));
  const matches = catalog.filter((variant) => candidates.has(variant.barcode));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const exact = matches.filter((variant) => variant.barcode === gtin || `0${variant.barcode}` === gtin);
    if (exact.length === 1) return exact[0];
  }
  return null;
}

function onlineVerificationConfigured(): boolean {
  return Boolean(process.env.FBS_KIZ_TRUEAPI_URL?.trim() && process.env.FBS_KIZ_TRUEAPI_TOKEN?.trim());
}

async function verifyOnline(value: string): Promise<{ status: FbsKizVerificationStatus; source: string; message: string }> {
  const url = process.env.FBS_KIZ_TRUEAPI_URL?.trim();
  const token = process.env.FBS_KIZ_TRUEAPI_TOKEN?.trim();
  if (!url || !token) {
    return {
      status: "format_verified",
      source: "local",
      message: "Структура, контрольная цифра GTIN и соответствие товару проверены локально. TrueAPI не подключён.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": token },
      body: JSON.stringify({ codes: [value] }),
      signal: controller.signal,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const codes = Array.isArray(payload.codes) ? payload.codes as Array<Record<string, unknown>> : [];
    const result = codes[0];
    if (!response.ok || !result) throw new Error(`TrueAPI не вернул результат проверки (${response.status})`);
    const accepted = result.valid === true
      && result.found !== false
      && result.isBlocked !== true
      && result.sold !== true
      && result.realizable !== false;
    if (!accepted) {
      const reason = String(result.message || result.errorCode || "код отклонён");
      throw new Error(`«Честный знак» не подтвердил код: ${reason}`);
    }
    return { status: "online_verified", source: "trueapi", message: "Код подтверждён TrueAPI «Честного знака»." };
  } finally {
    clearTimeout(timer);
  }
}

async function recordError(input: { value: string; message: string; gtin?: string; serial?: string }) {
  const context = getOrganizationContext();
  await pgRows(`
    INSERT INTO fbs_kiz_archive_events (
      archive_id,event_type,code_hash,code_tail,nm_id,product_name,size_name,
      verification_status,message,created_by_user_id
    ) VALUES (NULL,'error',?,?,?,?,?,'','error',?,?)
  `, [
    hash(normalizeFbsDataMatrix(input.value || "")),
    input.serial ? codeTail(input.serial) : "—",
    null,
    "",
    "",
    input.message.slice(0, 1000),
    context?.userId || null,
  ]).catch(() => undefined);
}

export async function addFbsKizToArchive(rawValue: string) {
  let parsed;
  try {
    parsed = parseFbsDataMatrix(rawValue);
    if (parsed.format === "identification") {
      throw new Error("Нужен полный Data Matrix с криптографической частью AI 91/92 или AI 93");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordError({ value: rawValue, message });
    throw error;
  }

  const catalog = await loadCatalog();
  const variant = findCatalogVariant(catalog, parsed.gtin);
  if (!variant) {
    const message = `GTIN ${parsed.gtin} не сопоставлен ни с одним товаром и размером выбранного юрлица`;
    await recordError({ value: parsed.value, message, gtin: parsed.gtin, serial: parsed.serial });
    throw new Error(message);
  }

  let verification;
  try {
    verification = await verifyOnline(parsed.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordError({ value: parsed.value, message, gtin: parsed.gtin, serial: parsed.serial });
    throw error;
  }

  const identityHash = hash(parsed.identity);
  const valueHash = hash(parsed.value);
  const context = getOrganizationContext();
  const result = await withPgTransaction(async (client) => {
    const duplicate = await client.query<ArchiveRow>(`
      SELECT * FROM fbs_kiz_archive WHERE identity_hash=$1 FOR UPDATE
    `, [identityHash]);
    if (duplicate.rows[0]) {
      const existing = duplicate.rows[0];
      if (existing.code_hash !== valueHash) {
        throw new Error("Уже сохранён КИЗ с тем же GTIN и серийным номером, но другой криптографической частью");
      }
      const upgraded = verification.status === "online_verified" && existing.verification_status !== "online_verified";
      await client.query(`
        UPDATE fbs_kiz_archive
        SET scan_count=scan_count+1,
            verification_status=CASE WHEN $2 THEN 'online_verified' ELSE verification_status END,
            verification_source=CASE WHEN $2 THEN $3 ELSE verification_source END,
            verification_message=CASE WHEN $2 THEN $4 ELSE verification_message END,
            last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE archive_id=$1
      `, [existing.archive_id, upgraded, verification.source, verification.message]);
      const duplicateStatus = upgraded ? "online_verified" : existing.verification_status;
      await client.query(`
        INSERT INTO fbs_kiz_archive_events (
          archive_id,event_type,code_hash,code_tail,nm_id,product_name,size_name,
          verification_status,message,created_by_user_id
        ) VALUES ($1,'duplicate',$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        existing.archive_id,
        valueHash,
        codeTail(parsed.serial),
        existing.nm_id,
        existing.product_name,
        existing.size_name,
        duplicateStatus,
        "КИЗ уже находится в архиве; новая запись не создана",
        context?.userId || null,
      ]);
      return {
        row: upgraded
          ? { ...existing, verification_status: "online_verified" as const, verification_source: verification.source, verification_message: verification.message }
          : existing,
        duplicate: true,
      };
    }

    const inserted = await client.query<ArchiveRow>(`
      INSERT INTO fbs_kiz_archive (
        identity_hash,code_hash,value_ciphertext,gtin,serial_tail,nm_id,chrt_id,
        vendor_code,product_name,size_name,barcode,verification_status,
        verification_source,verification_message,created_by_user_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `, [
      identityHash,
      valueHash,
      encryptCode(parsed.value),
      parsed.gtin,
      parsed.serial.slice(-8),
      variant.nmId,
      variant.chrtId,
      variant.vendorCode,
      variant.productName,
      variant.sizeName,
      variant.barcode,
      verification.status,
      verification.source,
      verification.message,
      context?.userId || null,
    ]);
    const row = inserted.rows[0];
    await client.query(`
      INSERT INTO fbs_kiz_archive_events (
        archive_id,event_type,code_hash,code_tail,nm_id,product_name,size_name,
        verification_status,message,created_by_user_id
      ) VALUES ($1,'added',$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      row.archive_id,
      valueHash,
      codeTail(parsed.serial),
      variant.nmId,
      variant.productName,
      variant.sizeName,
      verification.status,
      verification.message,
      context?.userId || null,
    ]);
    return { row, duplicate: false };
  }).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await recordError({ value: parsed.value, message, gtin: parsed.gtin, serial: parsed.serial });
    throw error;
  });

  const sizes = splitSize(result.row.size_name);
  return {
    duplicate: result.duplicate,
    item: {
      archiveId: Number(result.row.archive_id),
      unitRef: `КИЗ-${String(result.row.archive_id).padStart(6, "0")}`,
      codeTail: codeTail(parsed.serial),
      nmId: Number(result.row.nm_id),
      vendorCode: result.row.vendor_code,
      productName: result.row.product_name,
      sizeName: result.row.size_name,
      wbSize: sizes.wbSize,
      russianSize: sizes.russianSize,
      barcode: result.row.barcode,
      verificationStatus: result.row.verification_status,
      verificationMessage: result.row.verification_message,
    },
  };
}

function printBatch(row: PrintJobRow): FbsKizPrintBatch {
  return {
    jobId: row.job_id,
    nmId: Number(row.nm_id),
    barcode: row.sku,
    productName: row.product_name,
    sizeName: row.size_name,
    total: Number(row.total_count),
    printed: Number(row.printed_count),
    status: row.status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createFbsKizPrintBatch(input: { nmId: number; barcode: string; quantity: number }): Promise<FbsKizPrintBatch> {
  const nmId = Number(input.nmId);
  const barcode = String(input.barcode || "").trim();
  const quantity = Number(input.quantity);
  if (!Number.isSafeInteger(nmId) || nmId <= 0 || !barcode) throw new Error("Не удалось определить товар и размер");
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 500) throw new Error("Количество для одной печати должно быть от 1 до 500");
  const catalog = await loadCatalog();
  const variant = catalog.find((item) => item.nmId === nmId && item.barcode === barcode);
  if (!variant) throw new Error("Товар или размер больше не найден в каталоге выбранного юрлица");
  const context = getOrganizationContext();

  return withPgTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fbs-kiz-print:${nmId}:${barcode}`]);
    const existing = await client.query<PrintJobRow>(`
      SELECT job_id,nm_id,sku,product_name,size_name,total_count,printed_count,status,last_error,created_at,updated_at
      FROM fbs_print_jobs
      WHERE supply_id='__kiz_archive__' AND nm_id=$1 AND sku=$2 AND status IN ('queued','printing','paused')
      ORDER BY created_at DESC LIMIT 1
    `, [nmId, barcode]);
    if (existing.rows[0]) return printBatch(existing.rows[0]);

    const agent = await client.query(`
      SELECT 1 FROM fbs_print_agents
      WHERE enabled=TRUE AND last_seen_at>=CURRENT_TIMESTAMP-INTERVAL '45 seconds'
      ORDER BY last_seen_at DESC LIMIT 1
    `);
    if (!agent.rows[0]) throw new Error("Принтер не подключён. Откройте раздел «Принтер» и дождитесь зелёного статуса");

    const selected = await client.query<ArchiveRow>(`
      SELECT * FROM fbs_kiz_archive
      WHERE nm_id=$1 AND barcode=$2 AND print_state='available' AND value_ciphertext<>''
      ORDER BY archive_id
      FOR UPDATE SKIP LOCKED
      LIMIT $3
    `, [nmId, barcode, quantity]);
    if (selected.rows.length < quantity) {
      throw new Error(`Доступно только ${selected.rows.length} КИЗ для этого артикула и размера`);
    }

    const jobId = crypto.randomUUID();
    const groupKey = `kiz-archive:${jobId}`;
    await client.query(`
      INSERT INTO fbs_print_jobs (
        job_id,supply_id,group_key,nm_id,chrt_id,sku,product_name,size_name,total_count
      ) VALUES ($1,'__kiz_archive__',$2,$3,$4,$5,$6,$7,$8)
    `, [jobId, groupKey, nmId, variant.chrtId, barcode, variant.productName, variant.sizeName, quantity]);

    for (let index = 0; index < selected.rows.length; index += 1) {
      const row = selected.rows[index];
      const position = index + 1;
      const value = decryptCode(row.value_ciphertext);
      const parsed = parseFbsDataMatrix(value);
      if (hash(parsed.value) !== row.code_hash) throw new Error(`Контрольная сумма ${codeTail(parsed.serial)} не совпала`);
      const stickerFile = await renderKizLabel(parsed.value, {
        position,
        total: quantity,
        nmId,
        sizeName: splitSize(variant.sizeName).russianSize,
        codeTail: codeTail(parsed.serial),
      });
      await client.query(`
        INSERT INTO fbs_print_job_items (
          job_id,position,order_id,sticker_barcode,sticker_file,sticker_format,reference_id
        ) VALUES ($1,$2,$3,$4,$5,'png',$6)
      `, [jobId, position, row.archive_id, row.code_hash, stickerFile, String(row.archive_id)]);
      await client.query(`
        UPDATE fbs_kiz_archive
        SET print_state='reserved',print_job_id=$2,print_position=$3,reserved_at=CURRENT_TIMESTAMP,
            printed_by_user_id=$4,updated_at=CURRENT_TIMESTAMP
        WHERE archive_id=$1
      `, [row.archive_id, jobId, position, context?.userId || null]);
      await client.query(`
        INSERT INTO fbs_kiz_archive_events (
          archive_id,event_type,code_hash,code_tail,nm_id,product_name,size_name,
          verification_status,message,created_by_user_id
        ) VALUES ($1,'print_reserved',$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        row.archive_id,
        row.code_hash,
        codeTail(row.serial_tail),
        row.nm_id,
        row.product_name,
        row.size_name,
        row.verification_status,
        `Зарезервирован для печати: ${position}/${quantity}`,
        context?.userId || null,
      ]);
    }

    const created = await client.query<PrintJobRow>(`
      SELECT job_id,nm_id,sku,product_name,size_name,total_count,printed_count,status,last_error,created_at,updated_at
      FROM fbs_print_jobs WHERE job_id=$1
    `, [jobId]);
    return printBatch(created.rows[0]);
  });
}

export async function resumeFbsKizPrintBatch(jobIdInput: string, lastPrintedPositionInput: number): Promise<FbsKizPrintBatch> {
  const jobId = String(jobIdInput || "").trim();
  const lastPrintedPosition = Number(lastPrintedPositionInput);
  if (!jobId || !Number.isSafeInteger(lastPrintedPosition) || lastPrintedPosition < 0) throw new Error("Укажите последнюю физически напечатанную позицию");
  const context = getOrganizationContext();
  return withPgTransaction(async (client) => {
    const locked = await client.query<PrintJobRow & { group_key: string }>(`
      SELECT job_id,group_key,nm_id,sku,product_name,size_name,total_count,printed_count,status,last_error,created_at,updated_at
      FROM fbs_print_jobs WHERE job_id=$1 FOR UPDATE
    `, [jobId]);
    const job = locked.rows[0];
    if (!job || !job.group_key.startsWith("kiz-archive:")) throw new Error("Пачка КИЗ не найдена");
    if (job.status !== "paused") throw new Error("Восстановление доступно только для остановленной печати");
    if (lastPrintedPosition < Number(job.printed_count) || lastPrintedPosition > Number(job.total_count)) {
      throw new Error(`Допустима позиция от ${job.printed_count} до ${job.total_count}`);
    }

    const recovered = await client.query<ArchiveRow>(`
      UPDATE fbs_kiz_archive
      SET print_state='printed',value_ciphertext='',printed_at=COALESCE(printed_at,CURRENT_TIMESTAMP),
          printed_by_user_id=COALESCE(printed_by_user_id,$3),updated_at=CURRENT_TIMESTAMP
      WHERE print_job_id=$1 AND print_position<=$2 AND print_state<>'printed'
      RETURNING *
    `, [jobId, lastPrintedPosition, context?.userId || null]);
    for (const row of recovered.rows) {
      await client.query(`
        INSERT INTO fbs_kiz_archive_events (
          archive_id,event_type,code_hash,code_tail,nm_id,product_name,size_name,
          verification_status,message,created_by_user_id
        ) VALUES ($1,'print_recovered',$2,$3,$4,$5,$6,$7,$8,$9)
      `, [row.archive_id, row.code_hash, codeTail(row.serial_tail), row.nm_id, row.product_name, row.size_name, row.verification_status, `Печать подтверждена вручную: позиция ${row.print_position}`, context?.userId || null]);
    }
    await client.query(`
      UPDATE fbs_print_job_items
      SET status='printed',printed_at=COALESCE(printed_at,CURRENT_TIMESTAMP),lease_until=NULL,sticker_file=''
      WHERE job_id=$1 AND position<=$2
    `, [jobId, lastPrintedPosition]);
    await client.query(`
      UPDATE fbs_print_job_items
      SET status='pending',lease_until=NULL
      WHERE job_id=$1 AND position>$2 AND status IN ('printing','uncertain')
    `, [jobId, lastPrintedPosition]);
    const completed = lastPrintedPosition === Number(job.total_count);
    await client.query(`
      UPDATE fbs_print_jobs
      SET printed_count=$2,status=$3,last_error='',updated_at=CURRENT_TIMESTAMP,
          completed_at=CASE WHEN $3='completed' THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE job_id=$1
    `, [jobId, lastPrintedPosition, completed ? "completed" : "queued"]);
    const updated = await client.query<PrintJobRow>(`
      SELECT job_id,nm_id,sku,product_name,size_name,total_count,printed_count,status,last_error,created_at,updated_at
      FROM fbs_print_jobs WHERE job_id=$1
    `, [jobId]);
    return printBatch(updated.rows[0]);
  });
}

export async function getFbsKizArchiveSnapshot(): Promise<FbsKizArchiveSnapshot> {
  await withPgTransaction(async (client) => {
    const expired = await client.query<{ job_id: string }>(`
      UPDATE fbs_print_job_items AS item
      SET status='uncertain',lease_until=NULL
      FROM fbs_print_jobs AS job
      WHERE job.job_id=item.job_id AND job.supply_id='__kiz_archive__'
        AND item.status='printing' AND item.lease_until<CURRENT_TIMESTAMP
      RETURNING item.job_id
    `);
    const jobIds = Array.from(new Set(expired.rows.map((row) => row.job_id)));
    if (jobIds.length) {
      await client.query(`
        UPDATE fbs_print_jobs
        SET status='paused',last_error='Связь с программой печати прервалась. Укажите последнюю физически вышедшую этикетку.',updated_at=CURRENT_TIMESTAMP
        WHERE job_id=ANY($1::text[]) AND status='printing'
      `, [jobIds]);
    }
  });
  const [catalog, archive, printJobs, events, errorSummary] = await Promise.all([
    loadCatalog(),
    pgRows<ArchiveRow>(`SELECT * FROM fbs_kiz_archive ORDER BY archive_id DESC`),
    pgRows<PrintJobRow>(`
      SELECT job_id,nm_id,sku,product_name,size_name,total_count,printed_count,status,last_error,created_at,updated_at
      FROM fbs_print_jobs
      WHERE supply_id='__kiz_archive__' AND created_at>=CURRENT_TIMESTAMP-INTERVAL '7 days'
      ORDER BY created_at DESC LIMIT 40
    `),
    pgRows<EventRow>(`SELECT * FROM fbs_kiz_archive_events ORDER BY event_id DESC LIMIT 80`),
    pgRows<{ count: number }>(`
      SELECT COUNT(*)::int AS count FROM fbs_kiz_archive_events
      WHERE event_type='error' AND created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
    `),
  ]);

  const counts = new Map<string, { total: number; available: number; reserved: number; printed: number; onlineVerified: number; formatVerified: number }>();
  for (const row of archive) {
    const key = `${Number(row.nm_id)}:${row.barcode}`;
    const current = counts.get(key) || { total: 0, available: 0, reserved: 0, printed: 0, onlineVerified: 0, formatVerified: 0 };
    current.total += 1;
    if (row.print_state === "available") current.available += 1;
    if (row.print_state === "reserved") current.reserved += 1;
    if (row.print_state === "printed") current.printed += 1;
    if (row.verification_status === "online_verified") current.onlineVerified += 1;
    if (row.verification_status === "format_verified") current.formatVerified += 1;
    counts.set(key, current);
  }

  const products = new Map<number, FbsKizArchiveProduct>();
  for (const variant of catalog) {
    const count = counts.get(`${variant.nmId}:${variant.barcode}`) || { total: 0, available: 0, reserved: 0, printed: 0, onlineVerified: 0, formatVerified: 0 };
    let product = products.get(variant.nmId);
    if (!product) {
      product = {
        nmId: variant.nmId,
        vendorCode: variant.vendorCode,
        productName: variant.productName,
        total: 0,
        available: 0,
        reserved: 0,
        printed: 0,
        onlineVerified: 0,
        formatVerified: 0,
        sizes: [],
      };
      products.set(variant.nmId, product);
    } else if (product.productName === product.vendorCode && variant.productName !== variant.vendorCode) {
      product.productName = variant.productName;
      product.vendorCode = variant.vendorCode;
    }
    product.total += count.total;
    product.available += count.available;
    product.reserved += count.reserved;
    product.printed += count.printed;
    product.onlineVerified += count.onlineVerified;
    product.formatVerified += count.formatVerified;
    product.sizes.push({ ...variant, ...count });
  }

  const productList = Array.from(products.values())
    .map((product) => ({ ...product, sizes: product.sizes.sort((a, b) => sizeOrder(a.russianSize) - sizeOrder(b.russianSize)) }))
    .sort((left, right) => right.total - left.total || left.nmId - right.nmId);

  const summary = archive.reduce((acc, row) => {
    acc.total += 1;
    if (row.print_state === "available") acc.available += 1;
    if (row.print_state === "reserved") acc.reserved += 1;
    if (row.print_state === "printed") acc.printed += 1;
    if (row.verification_status === "online_verified") acc.onlineVerified += 1;
    if (row.verification_status === "format_verified") acc.formatVerified += 1;
    return acc;
  }, { total: 0, available: 0, reserved: 0, printed: 0, onlineVerified: 0, formatVerified: 0, errors24h: Number(errorSummary[0]?.count || 0) });

  return {
    summary,
    onlineVerificationConfigured: onlineVerificationConfigured(),
    products: productList,
    printBatches: printJobs.map(printBatch),
    events: events.map((event) => {
      const sizes = splitSize(event.size_name || "");
      return {
        id: Number(event.event_id),
        archiveId: event.archive_id == null ? null : Number(event.archive_id),
        eventType: event.event_type,
        codeTail: event.code_tail,
        nmId: event.nm_id == null ? null : Number(event.nm_id),
        productName: event.product_name,
        sizeName: event.size_name,
        wbSize: sizes.wbSize,
        russianSize: sizes.russianSize,
        verificationStatus: event.verification_status,
        message: event.message,
        operator: event.created_by_user_id ? `Сотрудник #${event.created_by_user_id}` : "Система",
        createdAt: event.created_at,
      };
    }),
  };
}
