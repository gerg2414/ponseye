"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoRefresh({ intervalMs = 5_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let pauseUntil = 0;
    const pauseForNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("a[href]")) pauseUntil = Date.now() + 15_000;
    };

    document.addEventListener("click", pauseForNavigation, true);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() >= pauseUntil) router.refresh();
    }, intervalMs);

    return () => {
      document.removeEventListener("click", pauseForNavigation, true);
      window.clearInterval(interval);
    };
  }, [intervalMs, router]);

  return null;
}
