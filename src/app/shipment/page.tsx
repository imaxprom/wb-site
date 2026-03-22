"use client";

import { ShipmentTable } from "@/components/ShipmentTable";

export default function ShipmentPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Расчёт отгрузки</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          План отгрузки на региональные склады Wildberries
        </p>
      </div>
      <ShipmentTable />
    </div>
  );
}
