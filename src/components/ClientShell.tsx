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
      <ShellWithNav initialCollapsed={initialSidebarCollapsed}>{children}</ShellWithNav>
    </DataProvider>
  );
}

function ShellWithNav({ children, initialCollapsed }: { children: React.ReactNode; initialCollapsed: boolean }) {
  const [collapsed, setCollapsed] = React.useState<boolean>(initialCollapsed);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `mphub-sidebar=${next ? "collapsed" : "expanded"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main className={cn("flex-1 ml-0 p-4 md:p-6 transition-all duration-200", collapsed ? "md:ml-16" : "md:ml-60")}>
        {children}
      </main>
    </div>
  );
}
