"use client";

import { useEffect, useRef, useState } from "react";

export function DatabaseCopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  async function copyAddress() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <button type="button" onClick={copyAddress} aria-label={`Copy contract address ${address}`} title={copied ? "Copied" : "Copy CA"}>
      {copied ? (
        <svg viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true"><path d="M1 8h3v3h2v3h3v-3h2V8h2V5h2V2h-3v3h-2v3H8v3H7V8H4V6H1z" /></svg>
      ) : (
        <svg viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true"><path d="M5 1h10v10h-3V4H5zm-4 4h10v10H1zm3 3v4h4V8z" /></svg>
      )}
    </button>
  );
}
