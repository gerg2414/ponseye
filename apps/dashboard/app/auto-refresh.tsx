"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

export function AutoRefresh({ intervalMs = 5_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let pauseUntil = 0;
    const pauseRefresh = (milliseconds = 5_000) => {
      pauseUntil = Math.max(pauseUntil, Date.now() + milliseconds);
    };
    const pauseForNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("a[href]")) pauseRefresh(15_000);
    };

    const pauseForInteraction = () => pauseRefresh();

    document.addEventListener("click", pauseForNavigation, true);
    document.addEventListener("scroll", pauseForInteraction, true);
    document.addEventListener("touchstart", pauseForInteraction, { passive: true, capture: true });
    document.addEventListener("touchmove", pauseForInteraction, { passive: true, capture: true });
    document.addEventListener("touchend", pauseForInteraction, { passive: true, capture: true });
    const interval = window.setInterval(() => {
      const linkIsActive = document.querySelector("a:hover, a:focus-visible");
      if (document.visibilityState === "visible" && Date.now() >= pauseUntil && !linkIsActive && !isPending) {
        startTransition(() => router.refresh());
      }
    }, intervalMs);

    return () => {
      document.removeEventListener("click", pauseForNavigation, true);
      document.removeEventListener("scroll", pauseForInteraction, true);
      document.removeEventListener("touchstart", pauseForInteraction, true);
      document.removeEventListener("touchmove", pauseForInteraction, true);
      document.removeEventListener("touchend", pauseForInteraction, true);
      window.clearInterval(interval);
    };
  }, [intervalMs, isPending, router]);

  return null;
}
