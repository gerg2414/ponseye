"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RecorderFeed } from "../../../lib/database";

const feedLabels: Record<string, string> = {
  launch_activity: "Launches",
  curve_trades: "Curve trades",
  market_trades: "Market trades",
  holder_snapshots: "Holders",
};

function seen(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function RecorderControl({ enabled, feeds }: { enabled: boolean; feeds: RecorderFeed[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeState(nextEnabled: boolean) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/recorder/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Recorder control failed");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recorder control failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={`recorderConsole ${enabled ? "isLive" : "isPaused"}`}>
      <div className="recorderConsoleState">
        <small>Recorder</small>
        <strong><i />{enabled ? "Running" : "Paused"}</strong>
        <span>{enabled ? "New launches and trades are being collected" : "Bitquery collection is switched off"}</span>
      </div>
      <div className="recorderFeedGrid">
        {feeds.map((feed) => (
          <article key={feed.feed}>
            <small>{feedLabels[feed.feed] ?? feed.feed.replaceAll("_", " ")}</small>
            <strong className={feed.status === "connected" ? "connected" : feed.status}>{feed.status === "stopped" ? "Paused" : feed.status}</strong>
            <span>{seen(feed.last_seen_at)}</span>
          </article>
        ))}
      </div>
      <div className="recorderConsoleAction">
        <button type="button" disabled={pending} onClick={() => changeState(!enabled)}>
          {pending ? "Updating…" : enabled ? "Pause recorder" : "Start recorder"}
        </button>
        {error ? <span role="alert">{error}</span> : null}
      </div>
    </section>
  );
}
