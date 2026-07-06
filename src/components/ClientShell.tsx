"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { DataProvider } from "@/components/DataProvider";
import { cn } from "@/lib/utils";

export function ClientShell({ children, initialSidebarCollapsed = false }: { children: React.ReactNode; initialSidebarCollapsed?: boolean }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";
  const [pinned, setPinned] = React.useState<boolean>(() => !initialSidebarCollapsed);

  const togglePinned = React.useCallback(() => {
    setPinned((current) => {
      const next = !current;
      document.cookie = `mphub-sidebar=${next ? "expanded" : "collapsed"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      return next;
    });
  }, []);

  if (isLoginPage) {
    return <>{children}</>;
  }

  const needsShipmentData =
    pathname.startsWith("/shipment") ||
    pathname.startsWith("/products") ||
    pathname.startsWith("/upload");

  const content = needsShipmentData ? <DataProvider>{children}</DataProvider> : children;
  return <ShellWithNav pinned={pinned} onTogglePinned={togglePinned}>{content}</ShellWithNav>;
}

function ShellWithNav({ children, pinned, onTogglePinned }: { children: React.ReactNode; pinned: boolean; onTogglePinned: () => void }) {
  return (
    <div className="min-h-screen">
      <Sidebar pinned={pinned} onTogglePinned={onTogglePinned} />
      <main className={cn("min-w-0 flex-1 ml-0 p-4 pt-16 md:p-6 transition-all duration-200", pinned ? "md:ml-60" : "md:ml-16")}>
        {children}
      </main>
    </div>
  );
}
