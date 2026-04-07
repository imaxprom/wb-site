import { WbAuth } from "@/components/WbAuth";
import { ReportDownload } from "@/components/ReportDownload";

export default function ReportsPage() {
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Отчёты WB</h1>
        <p className="text-[var(--text-muted)] mt-1">
          Авторизация и скачивание финансовых отчётов из кабинета продавца
        </p>
      </div>

      <WbAuth />
      <ReportDownload />
    </div>
  );
}
