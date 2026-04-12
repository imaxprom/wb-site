"use client";

import { AnalyticsProvider } from "@/modules/analytics/lib/AnalyticsProvider";

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return <AnalyticsProvider>{children}</AnalyticsProvider>;
}
