export interface Product {
  name: string;
  articleWB: string;
  brand: string;
  category: string;
  sizes: SizeConfig[];
}

export interface ProductOverride {
  customName: string;
  perBox: Record<string, number>; // barcode → perBox
  disabledSizes?: Record<string, boolean>; // barcode → true if excluded from shipment calc
}

export type ProductOverrides = Record<string, ProductOverride>; // articleWB → override

export interface SizeConfig {
  size: string;
  barcode: string;
  perBox: number;
}

export interface RegionConfig {
  id: string;
  name: string;
  shortName: string;
  percentage: number;
  warehouses: string[];
}

export interface RegionGroup {
  id: string;
  name: string;
  shortName: string;
  districts: string[]; // названия ФО: ['Центральный федеральный округ', ...]
  warehouses: string[];
  manualPercentage: number; // ручной %
}

export interface StockItem {
  brand: string;
  subject: string;
  articleSeller: string;
  articleWB: string;
  volume: string;
  barcode: string;
  size: string;
  inTransitToCustomers: number;
  inTransitReturns: number;
  totalOnWarehouses: number;
  warehouseStock: Record<string, number>;
}

export interface OrderRecord {
  date: string;
  warehouse: string;
  warehouseType: string;
  country: string;
  federalDistrict: string;
  region: string;
  articleSeller: string;
  articleWB: string;
  barcode: string;
  category: string;
  subject: string;
  brand: string;
  size: string;
  totalPrice: number;
  discountPercent: number;
  spp: number;
  finishedPrice: number;
  priceWithDisc: number;
  isCancel: boolean;
  cancelDate: string;
}

/** Pre-aggregated orders for client consumption (replaces sending 30k+ OrderRecord). */
export interface OrderAggregates {
  loadedDays: number;
  dateFrom: string;              // YYYY-MM-DD (inclusive)
  dateTo: string;                // YYYY-MM-DD (exclusive — "today", не учитываем)
  totalOrders: number;           // включая отмены
  totalNonCancelled: number;

  // Per-barcode: total count + cancels + weekly bucket
  perBarcode: Record<string, {
    barcode: string;
    articleWB: string;
    size: string;
    articleSeller: string;
    totalOrders: number;          // включая отмены
    cancelledOrders: number;
    weekly: {
      week: number;               // 1-based
      label: string;              // "Нед. 1"
      orders: number;              // количество заказов (включая отмены — так же считает getWeeklyOrders)
      dateRange: string;          // "DD.MM – DD.MM"
    }[];
  }>;

  // Per-district: для auto-процентов регионов (только не отменённые)
  perDistrict: Record<string, number>;

  // warehouse × district × region: детализация для РФ/СНГ разбивки (не отменённые)
  perWarehouseRegion: {
    warehouse: string;
    federalDistrict: string;      // "" если СНГ/вне РФ
    region: string;
    count: number;
  }[];
}

export interface ShipmentRow {
  size: string;
  barcode: string;
  perBox: number;
  regions: RegionShipment[];
  totalOnWB: number;
  totalOrders30d: number;
  planBoxes: number;
  reserveBoxes: number;
}

export interface ShipmentRowExtended extends ShipmentRow {
  articleWB: string;
  articleName: string;
}

export interface RegionShipment {
  regionId: string;
  plan: number;
  fact: number;
  boxes: number;
  pieces: number;
  warehouseBreakdown: Record<string, number>;
}

export interface ShipmentCalculation {
  product: Product;
  buyoutRate: number;
  regionConfigs: RegionConfig[];
  rows: ShipmentRow[];
  totals: {
    totalOnWB: number;
    totalOrders: number;
  };
}

export interface ColorMatrix {
  size: string;
  colors: Record<string, number>;
}

export interface DashboardStats {
  totalProducts: number;
  totalDeficit: number;
  totalOrders30d: number;
  cancelRate: number;
  emptyWarehouses: number;
  topDeficits: { size: string; product: string; deficit: number }[];
}

export interface UploadedData {
  stock: StockItem[];
  orders: OrderRecord[];
  products: Product[];
  uploadDate: string;
}

export interface AppSettings {
  buyoutRate: number;
  regions: RegionConfig[];
  regionMode?: "manual" | "auto";
  buyoutMode?: "manual" | "auto";
  regionGroups?: RegionGroup[];
  boxLengthCm?: number;
  boxWidthCm?: number;
  boxHeightCm?: number;
  uploadDays?: number;
  maxArticlesPerBox?: number;
  shipmentsPerMonth?: number;
  minUnits?: number;
  roundTo?: number;
  packingVariant?: string;
  // V2 Dynamics independent settings
  v2ShipmentsPerMonth?: number;
  v2MinUnits?: number;
  v2RoundTo?: number;
  v2MaxArticlesPerBox?: number;
  v2ViewMode?: string; // "units" | "boxes"
  v2UnitRounding?: number;
  shipmentCalcMode?: string; // "v1" | "v2" | "v3"
}
