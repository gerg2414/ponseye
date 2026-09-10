"use client";

import { useEffect, useRef, useState } from "react";

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);
  const displayValue = `${value.slice(2, 7)}.....${value.slice(-4)}`;

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button className="copyField" type="button" onClick={copy} aria-label={`Copy ${value}`} title="Copy full address">
      <span>{displayValue}</span>
      <i aria-hidden="true">
        {copied ? (
          <svg viewBox="0 0 18 18"><path d="M3 9l4 4 8-9" /></svg>
        ) : (
          <svg viewBox="0 0 18 18"><path d="M6 5V2h10v10h-3M2 6h10v10H2z" /></svg>
        )}
      </i>
      <b>{copied ? "Copied" : "Copy"}</b>
    </button>
  );
}
