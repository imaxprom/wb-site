import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { ClientShell } from "@/components/ClientShell";
import { isFbsPortalHostname } from "@/lib/fbs-portal-host";

const privateRobots: Metadata["robots"] = {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  if (isFbsPortalHostname(requestHeaders.get("host"))) {
    return {
      title: "FBS Склад — iMaxProm",
      description: "Сборка, маркировка и управление FBS-остатками",
      robots: privateRobots,
    };
  }
  return {
    title: "MpHub — от Seller для Seller",
    description: "Аналитика и управление продажами на маркетплейсах",
    robots: privateRobots,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const initialSidebarCollapsed = cookieStore.get("mphub-sidebar")?.value === "collapsed";
  const fbsPortal = isFbsPortalHostname(requestHeaders.get("host"));

  return (
    <html lang="ru" className={fbsPortal ? "fbs-readable-ui" : undefined}>
      <body className="antialiased">
        <ClientShell initialSidebarCollapsed={initialSidebarCollapsed} fbsPortal={fbsPortal}>
          {children}
        </ClientShell>
      </body>
    </html>
  );
}
