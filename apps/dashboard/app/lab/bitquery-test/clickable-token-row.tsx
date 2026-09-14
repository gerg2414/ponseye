"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

function isInteractive(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("a,button,details,summary,input,select,textarea"));
}

export function ClickableTokenRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();

  return (
    <tr
      className="clickableTokenRow"
      role="link"
      tabIndex={0}
      onClick={(event) => {
        if (isInteractive(event.target)) return;
        if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener,noreferrer");
        else router.push(href);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || isInteractive(event.target)) return;
        router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
