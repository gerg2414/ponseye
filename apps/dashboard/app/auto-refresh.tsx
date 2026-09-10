"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

export function AutoRefresh({ intervalMs = 5_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let pauseUntil = 0;
    const pauseForNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("a[href]")) pauseUntil = Date.now() + 15_000;
    };

    document.addEventListener("click", pauseForNavigation, true);
    const interval = window.setInterval(() => {
      const linkIsActive = document.querySelector("a:hover, a:focus-visible");
      if (document.visibilityState === "visible" && Date.now() >= pauseUntil && !linkIsActive && !isPending) {
        startTransition(() => router.refresh());
      }
    }, intervalMs);

    return () => {
      document.removeEventListener("click", pauseForNavigation, true);
      window.clearInterval(interval);
    };
  }, [intervalMs, isPending, router]);

  return null;
}
