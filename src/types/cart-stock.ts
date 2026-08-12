export type CartStockProductGroup = "rucksacks" | "underwear";

export interface CartStockWarehouse {
  id: number;
  name: string;
  /** WB warehouse directory flag: false means a seller/FBS warehouse. */
  isWb?: boolean;
  quantity: number;
  articles: number;
}

export interface CartStockProductWarehouse {
  warehouseId: number;
  warehouseName: string;
  quantity: number;
}

export interface CartStockProductSize {
  optionId: string;
  name: string;
  originalName: string;
  cartQuantity: number;
  warehouses: CartStockProductWarehouse[];
}

export interface CartStockProduct {
  articleWB: string;
  wbName: string;
  cartQuantity: number;
  clientTotalQuantity: number;
  missing: boolean;
  warehouses: CartStockProductWarehouse[];
  sizes: CartStockProductSize[];
}

export interface CartStockSnapshot {
  productGroup: CartStockProductGroup;
  capturedAt: string;
  source?: "wb-authorized-card" | "wb-anonymous-card";
  authenticated?: boolean;
  destinationId: string | null;
  destinationLabel: string;
  destinationIds?: string[];
  checkedDestinations?: number;
  checkedLocations?: string[];
  failedLocations?: string[];
  requestedArticles: number;
  returnedArticles: number;
  totalCartQuantity: number;
  warehouses: CartStockWarehouse[];
  products: CartStockProduct[];
}

export type CartStockJobStatus = "pending" | "processing" | "completed" | "failed";

export interface CartStockJobSummary {
  id: number;
  status: CartStockJobStatus;
  source: "manual" | "cron";
  productGroup: CartStockProductGroup;
  requestedArticles: number;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  leaseUntil: string | null;
  error: string | null;
}

export interface CartStockWorkerStatus {
  workerId: string;
  online: boolean;
  lastSeenAt: string;
  authState: "ok" | "refreshing" | "error" | "unknown";
  bearerExpiresAt: string | null;
  lastWbSuccessAt: string | null;
  lastError: string | null;
  outboxCount: number;
}

export interface CartStockQueueStatus {
  active: CartStockJobSummary | null;
  latest: CartStockJobSummary | null;
  worker: CartStockWorkerStatus | null;
}

export interface CartStockAttempt {
  capturedAt: string;
  status: "success" | "error";
  error: string | null;
}

export interface CartStockApiResponse {
  ok: boolean;
  snapshot: CartStockSnapshot | null;
  lastAttempt: CartStockAttempt | null;
  schedule: {
    timesMsk: string[];
    destinationLabel: string;
  };
  queue?: CartStockQueueStatus;
  error?: string;
}
