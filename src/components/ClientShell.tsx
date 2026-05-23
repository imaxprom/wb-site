"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { DataProvider, useData } from "@/components/DataProvider";
import { cn } from "@/lib/utils";

export function ClientShell({ children, initialSidebarCollapsed = false }: { children: React.ReactNode; initialSidebarCollapsed?: boolean }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <DataProvider>
      <ShellWithNav initialPinned={!initialSidebarCollapsed}>{children}</ShellWithNav>
    </DataProvider>
  );
}

function ShellWithNav({ children, initialPinned }: { children: React.ReactNode; initialPinned: boolean }) {
  const [pinned, setPinned] = React.useState<boolean>(initialPinned);

  const toggle = () => {
    const next = !pinned;
    setPinned(next);
    document.cookie = `mphub-sidebar=${next ? "expanded" : "collapsed"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  };

  return (
    <div className="min-h-screen">
      <Sidebar pinned={pinned} onTogglePinned={toggle} />
      <main className={cn("min-w-0 flex-1 ml-0 p-4 md:p-6 transition-all duration-200", pinned ? "md:ml-60" : "md:ml-16")}>
        {children}
      </main>
    </div>
  );
}
