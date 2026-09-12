"use client";

import { useEffect, useRef, useState } from "react";

const lanes = [
  { id: "sighted", label: "Sighted" },
  { id: "surveillance", label: "Surveilling" },
  { id: "acquired", label: "Acquired" },
] as const;
type LaneId = (typeof lanes)[number]["id"];

export function MobileLaneTabs({ counts }: { counts: Record<LaneId, number> }) {
  const initialLane = useRef<LaneId>(
    counts.sighted > 0 ? "sighted" : counts.surveillance > 0 ? "surveillance" : "acquired",
  ).current;
  const [active, setActive] = useState<LaneId>(initialLane);

  useEffect(() => {
    const board = document.querySelector<HTMLElement>(".launchBoard");
    if (!board) return;

    const updateActive = () => {
      const centre = board.scrollLeft + board.clientWidth / 2;
      const boardLeft = board.getBoundingClientRect().left;
      let nearest: LaneId = lanes[0].id;
      let distance = Number.POSITIVE_INFINITY;
      for (const lane of lanes) {
        const element = document.getElementById(`lane-${lane.id}`);
        if (!element) continue;
        const elementLeft = element.getBoundingClientRect().left - boardLeft + board.scrollLeft;
        const nextDistance = Math.abs(elementLeft + element.offsetWidth / 2 - centre);
        if (nextDistance < distance) {
          nearest = lane.id;
          distance = nextDistance;
        }
      }
      setActive(nearest);
    };

    board.addEventListener("scroll", updateActive, { passive: true });
    const initial = document.getElementById(`lane-${initialLane}`);
    if (initial) {
      const left = initial.getBoundingClientRect().left - board.getBoundingClientRect().left + board.scrollLeft - 8;
      board.scrollTo({ left, behavior: "auto" });
    }
    updateActive();
    return () => board.removeEventListener("scroll", updateActive);
  }, [initialLane]);

  const selectLane = (id: LaneId) => {
    const board = document.querySelector<HTMLElement>(".launchBoard");
    const lane = document.getElementById(`lane-${id}`);
    if (!board || !lane) return;
    const left = lane.getBoundingClientRect().left - board.getBoundingClientRect().left + board.scrollLeft - 8;
    board.scrollTo({ left, behavior: "smooth" });
    setActive(id);
  };

  return (
    <nav className="mobileLaneTabs" aria-label="Launch lanes" role="tablist">
      {lanes.map((lane) => (
        <button
          type="button"
          role="tab"
          aria-selected={active === lane.id}
          aria-controls={`lane-${lane.id}`}
          className={active === lane.id ? "active" : ""}
          onClick={() => selectLane(lane.id)}
          key={lane.id}
        >
          <span>{lane.label}</span><b>{counts[lane.id]}</b>
        </button>
      ))}
    </nav>
  );
}
