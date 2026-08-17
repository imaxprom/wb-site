import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireFbsAccess, requireFbsSettingsAccess } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";
import {
  addFbsFulfillmentOrdersToSupply,
  attachFbsMetadata,
  cancelFbsFulfillmentOrder,
  confirmFbsPickupPointRules,
  createFbsBoxes,
  createFbsDeliveryPass,
  createFbsFulfillmentSupply,
  deleteAllFbsBoxes,
  deliverReadyFbsSupply,
  enqueueFbsAssemblySgtin,
  getFbsFulfillmentLiveSnapshot,
  getFbsFulfillmentSnapshot,
  getFbsPassData,
  markFbsPacked,
  preflightFbsSupply,
  printFbsOrderStickers,
  processFbsMarkingQueue,
  removeFbsMetadata,
  reviewFbsOptionalMeta,
  scanFbsOrderSticker,
  scanFbsProduct,
  syncFbsFulfillment,
  verifyFbsMetadata,
} from "@/lib/fbs-fulfillment";
import type { FbsMetaType } from "@/lib/fbs-wb-api";
import { createFbsBatchPrintJob, createFbsBatchReprintJob, createFbsBoxQrPrintJob, createFbsPrintAgent, createFbsPrinterSupportRequest, createFbsSingleBoxQrPrintJob, createFbsSinglePrintJob, createFbsSupplyQrPrintJob, createFbsTestPrintJob, getFbsPrintAgentSnapshot, getFbsPrintQueueSnapshot, resolvePausedFbsPrintJob, resumeFbsPrintJob } from "@/lib/fbs-print-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function ids(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) : [];
}

function positive(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Некорректное поле ${field}`);
  return parsed;
}

async function snapshot() {
  const [fulfillment, printing] = await Promise.all([getFbsFulfillmentSnapshot(), getFbsPrintQueueSnapshot()]);
  return { ...fulfillment, ...printing };
}

export async function GET(request: NextRequest) {
  const authError = await requireFbsAccess(request, "assembly");
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);
  try {
    const liveSupplyId = request.nextUrl.searchParams.get("liveSupply")?.trim() || "";
    if (liveSupplyId) {
      const [fulfillment, printing] = await Promise.all([
        getFbsFulfillmentLiveSnapshot(liveSupplyId),
        getFbsPrintQueueSnapshot(liveSupplyId),
      ]);
      return NextResponse.json({ ok: true, ...fulfillment, ...printing });
    }
    if (request.nextUrl.searchParams.get("printerStatus") === "1") {
      return NextResponse.json({ ok: true, ...(await getFbsPrintAgentSnapshot()) });
    }
    if (request.nextUrl.searchParams.get("printer") === "1") {
      const supplyId = request.nextUrl.searchParams.get("supplyId")?.trim() || "";
      return NextResponse.json({ ok: true, ...(await getFbsPrintQueueSnapshot(supplyId)) });
    }
    const includePasses = request.nextUrl.searchParams.get("passes") === "1";
    return NextResponse.json({
      ok: true,
      ...(await snapshot()),
      ...(includePasses ? { passData: await getFbsPassData() } : {}),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireFbsAccess(request, "assembly", { mutation: true });
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);
  const readonlyError = localReadonlyGuard("FBS fulfillment mutation");
  if (readonlyError) return readonlyError;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || "");
  try {
    let result: unknown;
    switch (action) {
      case "sync":
        result = await syncFbsFulfillment();
        break;
      case "create_supply":
        result = await createFbsFulfillmentSupply({
          name: String(body.name || ""),
          deliveryMode: body.deliveryMode === "pvz" ? "pvz" : "warehouse",
          orderIds: ids(body.orderIds),
        });
        break;
      case "add_to_supply":
        result = await addFbsFulfillmentOrdersToSupply({
          supplyId: String(body.supplyId || ""),
          orderIds: ids(body.orderIds),
        });
        break;
      case "scan_product":
        result = await scanFbsProduct(String(body.supplyId || ""), String(body.value || ""));
        break;
      case "scan_sticker":
        result = await scanFbsOrderSticker(String(body.value || ""), String(body.supplyId || ""));
        break;
      case "attach_assembly_sgtin":
        {
          const orderId = positive(body.orderId, "orderId");
          result = await enqueueFbsAssemblySgtin(
            orderId,
            String(body.value || ""),
          );
          void processFbsMarkingQueue([orderId]).catch(() => undefined);
        }
        break;
      case "process_marking_queue":
        result = await processFbsMarkingQueue(ids(body.orderIds));
        break;
      case "attach_meta":
        result = await attachFbsMetadata(
          positive(body.orderId, "orderId"),
          String(body.metaType || "") as FbsMetaType,
          String(body.value || ""),
        );
        break;
      case "remove_meta":
        if (body.confirmation !== "УДАЛИТЬ") throw new Error("Подтвердите удаление метаданных");
        await removeFbsMetadata(positive(body.orderId, "orderId"), String(body.metaType || "") as Exclude<FbsMetaType, "expiration">);
        result = { removed: true };
        break;
      case "cancel_order":
        if (body.confirmation !== `ОТМЕНИТЬ ${positive(body.orderId, "orderId")}`) throw new Error("Подтверждение отмены не совпало");
        await cancelFbsFulfillmentOrder(positive(body.orderId, "orderId"));
        result = { cancelled: true };
        break;
      case "verify_meta":
        result = await verifyFbsMetadata(ids(body.orderIds));
        break;
      case "print_orders":
        result = await printFbsOrderStickers(ids(body.orderIds), Number(body.width) === 40 ? 40 : 58);
        break;
      case "mark_packed":
        await markFbsPacked(ids(body.orderIds));
        result = { packed: true };
        break;
      case "review_optional_meta":
        await reviewFbsOptionalMeta(positive(body.orderId, "orderId"));
        result = { reviewed: true };
        break;
      case "preflight":
        result = await preflightFbsSupply(String(body.supplyId || ""));
        break;
      case "deliver":
        if (body.confirmation !== "ПЕРЕДАТЬ") throw new Error("Для необратимой передачи введите ПЕРЕДАТЬ");
        await deliverReadyFbsSupply(String(body.supplyId || ""));
        result = { delivered: true };
        break;
      case "create_boxes":
        result = await createFbsBoxes(String(body.supplyId || ""), positive(body.amount, "amount"));
        break;
      case "delete_boxes":
        if (body.confirmation !== "УДАЛИТЬ") throw new Error("Подтвердите удаление грузомест");
        result = await deleteAllFbsBoxes(String(body.supplyId || ""));
        break;
      case "confirm_pvz_rules":
        if (body.confirmation !== "ПОДТВЕРЖДАЮ") throw new Error("Подтвердите требования ПВЗ");
        result = await confirmFbsPickupPointRules(String(body.supplyId || ""));
        break;
      case "print_boxes":
        result = await createFbsBoxQrPrintJob(String(body.supplyId || ""));
        break;
      case "print_single_box":
        result = await createFbsSingleBoxQrPrintJob(String(body.supplyId || ""), String(body.boxId || ""));
        break;
      case "print_supply_qr":
        result = await createFbsSupplyQrPrintJob(String(body.supplyId || ""));
        break;
      case "create_batch_print":
        result = await createFbsBatchPrintJob({
          supplyId: String(body.supplyId || ""),
          nmId: positive(body.nmId, "nmId"),
          chrtId: positive(body.chrtId, "chrtId"),
          sku: String(body.sku || ""),
          quantity: body.quantity ? positive(body.quantity, "quantity") : undefined,
        });
        break;
      case "create_single_print":
        result = await createFbsSinglePrintJob(positive(body.orderId, "orderId"));
        break;
      case "create_batch_reprint":
        result = await createFbsBatchReprintJob(ids(body.orderIds));
        break;
      case "create_print_agent":
        {
          const settingsError = await requireFbsSettingsAccess(request, { mutation: true });
          if (settingsError) return settingsError;
          activateAuthenticatedRequestContext(request);
        }
        result = await createFbsPrintAgent(String(body.name || "FBS print-agent"));
        break;
      case "test_print":
        result = await createFbsTestPrintJob();
        break;
      case "printer_support":
        result = await createFbsPrinterSupportRequest({
          page: String(body.page || "fbs"),
          userAgent: String(request.headers.get("user-agent") || "").slice(0, 500),
        });
        break;
      case "resume_print_job":
        await resumeFbsPrintJob(String(body.jobId || ""), String(body.lastBarcode || ""));
        result = { resumed: true };
        break;
      case "resolve_print_pause":
        result = await resolvePausedFbsPrintJob(
          String(body.jobId || ""),
          body.outcome === "printed" ? "printed" : "retry",
          String(body.scannedBarcode || ""),
        );
        break;
      case "pass_data":
        result = await getFbsPassData();
        break;
      case "create_pass":
        result = await createFbsDeliveryPass({
          firstName: String(body.firstName || ""),
          lastName: String(body.lastName || ""),
          carModel: String(body.carModel || ""),
          carNumber: String(body.carNumber || ""),
          officeId: positive(body.officeId, "officeId"),
        });
        break;
      default:
        return NextResponse.json({ ok: false, error: "Неизвестное действие" }, { status: 400 });
    }
    return NextResponse.json(body.compact === true
      ? { ok: true, result }
      : { ok: true, result, snapshot: await snapshot() });
  } catch (error) {
    return apiError(error);
  }
}
