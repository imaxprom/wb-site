import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { ClientShell } from "@/components/ClientShell";

export const metadata: Metadata = {
  title: "MpHub — от Seller для Seller",
  description: "Аналитика и управление продажами на маркетплейсах",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const initialSidebarCollapsed = cookieStore.get("mphub-sidebar")?.value === "collapsed";

  return (
    <html lang="ru">
      <body className="antialiased">
        <ClientShell initialSidebarCollapsed={initialSidebarCollapsed}>
          {children}
        </ClientShell>
      </body>
    </html>
  );
}
