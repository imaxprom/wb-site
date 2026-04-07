import type { Metadata } from "next";
import "./globals.css";
import { ClientShell } from "@/components/ClientShell";

export const metadata: Metadata = {
  title: "MpHub — от Seller для Seller",
  description: "Аналитика и управление продажами на маркетплейсах",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="antialiased">
        <ClientShell>
          {children}
        </ClientShell>
      </body>
    </html>
  );
}
