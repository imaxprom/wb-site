"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { DataProvider } from "@/components/DataProvider";
import { cn } from "@/lib/utils";
import { type OrganizationsPayload } from "@/components/OrganizationSwitcher";
import { FbsPortalShell } from "@/components/FbsPortalShell";
import { FbsPortalLogin } from "@/components/FbsPortalLogin";

export function ClientShell({ children, initialSidebarCollapsed = false, fbsPortal = false }: { children: React.ReactNode; initialSidebarCollapsed?: boolean; fbsPortal?: boolean }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login" || pathname === "/fbs-portal/login";
  const [pinned, setPinned] = React.useState<boolean>(() => !initialSidebarCollapsed);
  const [organizations, setOrganizations] = React.useState<OrganizationsPayload | null>(null);

  React.useEffect(() => {
    if (isLoginPage || fbsPortal) return;
    let cancelled = false;
    fetch("/api/organizations", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!cancelled) setOrganizations(payload);
      })
      .catch(() => {
        if (!cancelled) setOrganizations(null);
      });
    return () => { cancelled = true; };
  }, [fbsPortal, isLoginPage]);

  const togglePinned = React.useCallback(() => {
    setPinned((current) => {
      const next = !current;
      document.cookie = `mphub-sidebar=${next ? "expanded" : "collapsed"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      return next;
    });
  }, []);

  if (isLoginPage) {
    return fbsPortal ? <FbsPortalLogin /> : <>{children}</>;
  }

  if (fbsPortal) return <FbsPortalShell>{children}</FbsPortalShell>;

  const needsShipmentData =
    pathname.startsWith("/shipment") ||
    pathname.startsWith("/products") ||
    pathname.startsWith("/upload");

  const content = needsShipmentData ? <DataProvider>{children}</DataProvider> : children;
  return (
    <ShellWithNav
      pinned={pinned}
      onTogglePinned={togglePinned}
      organizations={organizations}
    >
      {content}
    </ShellWithNav>
  );
}

function ShellWithNav({
  children,
  pinned,
  onTogglePinned,
  organizations,
}: {
  children: React.ReactNode;
  pinned: boolean;
  onTogglePinned: () => void;
  organizations: OrganizationsPayload | null;
}) {
  return (
    <div className="min-h-screen">
      <Sidebar
        pinned={pinned}
        onTogglePinned={onTogglePinned}
        isSystemAdmin={organizations?.isSystemAdmin === true}
        organizations={organizations}
      />
      <main className={cn("min-w-0 flex-1 ml-0 p-4 pt-16 md:p-6 transition-all duration-200", pinned ? "md:ml-60" : "md:ml-16")}>
        {children}
      </main>
    </div>
  );
}
