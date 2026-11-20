"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const SUMMARY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** Brief section 7: "It recomputes... every five minutes while the app is open." */
export function SummaryAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), SUMMARY_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
