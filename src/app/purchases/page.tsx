import PurchasesCalculator from "./test/page";

export default function PurchasesPage() {
  return (
    <PurchasesCalculator
      title="Закупки"
      description="Расчёт потребности по комплектам: остатки из Google Sheets, продажи и потребность в штуках и пачках."
      showPlan={false}
    />
  );
}
