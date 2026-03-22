export interface Product {
  name: string;
  articleWB: string;
  brand: string;
  category: string;
  sizes: SizeConfig[];
}

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
  articleWB: number;
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
