"use client";

import ProductsSplitView from "@/modules/shipment/components/ProductsSplitView";

export default function ShipmentProductsTestPage() {
  return (
    <ProductsSplitView
      title="Товары: тестовый вид"
      description="Слева артикулы, справа размерная таблица выбранного артикула."
    />
  );
}
