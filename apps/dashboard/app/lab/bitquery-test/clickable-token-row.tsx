"use client";

import type { ReactNode } from "react";

function isInteractive(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("a,button,details,summary,input,select,textarea"));
}

export function ClickableTokenRow({ href, children }: { href: string; children: ReactNode }) {
  return (
    <tr
      className="clickableTokenRow"
      role="link"
      tabIndex={0}
      onClick={(event) => {
        if (isInteractive(event.target)) return;
        window.open(href, "_blank", "noopener,noreferrer");
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || isInteractive(event.target)) return;
        window.open(href, "_blank", "noopener,noreferrer");
      }}
    >
      {children}
    </tr>
  );
}
