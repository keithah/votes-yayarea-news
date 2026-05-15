"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { inferRouteAnalytics, trackRacePageView } from "../lib/analytics/events";

export function AnalyticsProvider() {
  const pathname = usePathname();
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || lastTrackedPath.current === pathname) return;
    lastTrackedPath.current = pathname;
    trackRacePageView(inferRouteAnalytics(pathname));
  }, [pathname]);

  return null;
}
