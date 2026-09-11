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
    <button type="button" onClick={copyAddress} aria-label={`Copy contract address ${address}`} title={address}>
      {copied ? "Copied" : "Copy CA"}
    </button>
  );
}
