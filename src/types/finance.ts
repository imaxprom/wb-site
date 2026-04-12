/** Raw PnL data returned by /api/finance/pnl */
export interface PnlApiResult {
  ppvz: number;
  retail_amount: number;
  realization: number;
  loyalty_compensation: number;
  total_services: number;
  cogs: number;
  net_qty: number;
  ad_spend: number;
  commission: number;
  logistics: number;
  storage: number;
  penalty: number;
  sales_rpwd: number;
  returns_rpwd: number;
  orders_sum: number;
  acceptance: number;
  rebill: number;
  other_services: number;
  jam: number;
  sales_qty: number;
  returns_qty: number;
}

/** Fully computed PnL shape used by UI */
export interface PnlData {
  period: string;
  total_orders: number;
  total_cancels: number;
  cancel_rate: number;
  sales_qty: number;
  returns_qty: number;
  revenue: number;
  loyalty_compensation: number;
  cogs: number;
  cogs_pct: number;
  logistics: number;
  logistics_pct: number;
  rebill: number;
  storage: number;
  penalty: number;
  ad_spend: number;
  ad_pct: number;
  tax_total: number;
  net_profit: number;
  margin: number;
  profit_per_unit: number;
  avg_buyout_rate: number;
  net_qty: number;
  ppvz: number;
  realization: number;
  commission: number;
  other_services: number;
  total_services: number;
  usn: number;
  nds: number;
  ddr: number;
  sales_rpwd: number;
  returns_rpwd: number;
  orders_sum: number;
  profitability: number;
  acceptance: number;
  jam: number;
}

/** Daily row returned by /api/finance/daily */
export interface DailyRow {
  date: string;
  orders_rub: number;
  sales_rub: number;
  returns_rub: number;
  realization: number;
  sales_qty: number;
  returns_qty: number;
  net_qty: number;
  commission: number;
  logistics: number;
  storage: number;
  penalty: number;
  ad_spend: number;
  cogs: number;
  profit: number;
}

export interface FilterOptions {
  suppliers: string[];
  brands: string[];
  subjects: string[];
  articles: { nm_id: number; sa_name: string }[];
  sizes: string[];
}

export interface ArticleDaily {
  date: string;
  orders: number;
  cancels: number;
  sales: number;
  returns: number;
  revenue: number;
}

export interface ArticleRow {
  nm_id: number;
  article: string;
  sales_qty: number;
  revenue: number;
  cogs_unit: number;
  logistics: number;
  log_per_unit: number;
  ad_allocated: number;
  margin: number;
  profit_per_unit: number;
  buyout_rate: number;
  daily: ArticleDaily[];
}

export interface AdCampaign {
  id: number;
  name: string;
  total: number;
  daily: Record<string, number>;
}

export interface TaxSettings {
  usnRate: number;
  ndsRate: number;
}
