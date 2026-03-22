import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { DataProvider } from "@/components/DataProvider";

export const metadata: Metadata = {
  title: "WB Отгрузка — Калькулятор отгрузки Wildberries",
  description: "Расчёт потребности в отгрузках на региональные склады Wildberries",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="antialiased">
        <DataProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 ml-0 md:ml-60 p-4 md:p-6">
              <div className="max-w-7xl">{children}</div>
            </main>
          </div>
        </DataProvider>
      </body>
    </html>
  );
}
