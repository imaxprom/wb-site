import PurchasesCalculator from "./test/page";

export default function PurchasesPage() {
  return (
    <PurchasesCalculator
      title="Закупки"
      description="Расчёт сырья для закупки: готовый WB-товар учитывается по своему артикулу, остаток упаковки раскладывается в цвета и размеры."
      showPlan={false}
    />
  );
}
