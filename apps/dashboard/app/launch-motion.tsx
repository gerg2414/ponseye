"use client";

import { useEffect, useRef, useState } from "react";

type CardState = "sighted" | "under_watch" | "target_locked";

type CardSnapshot = {
  element: HTMLElement;
  launchedAt: number;
  state: CardState;
};

const animationLength = 1_050;

function animate(element: HTMLElement | null, className: string, duration = animationLength) {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  window.setTimeout(() => element.classList.remove(className), duration);
}

function cardsOnBoard() {
  const cards = new Map<string, CardSnapshot>();
  document.querySelectorAll<HTMLElement>(".launchCardLink[data-token][data-state]").forEach((element) => {
    const token = element.dataset.token;
    const state = element.dataset.state as CardState | undefined;
    if (!token || !state) return;
    cards.set(token, {
      element,
      state,
      launchedAt: Date.parse(element.dataset.launchedAt ?? "") || 0,
    });
  });
  return cards;
}

function createBinnedGhost(snapshot: CardSnapshot) {
  const rect = snapshot.element.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const ghost = snapshot.element.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("href");
  ghost.className = "launchCardLink motionGhost";
  Object.assign(ghost.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  document.body.appendChild(ghost);
  animate(ghost, "motionBinned", animationLength);
  window.setTimeout(() => ghost.remove(), animationLength + 80);
}

function createDemoCard(name: string, symbol: string, score: number, acquired = false) {
  const wrapper = document.createElement("div");
  wrapper.className = "launchCardLink launchAnimationDemo";
  wrapper.innerHTML = `
    <article class="launchCard isCompact${acquired ? " isAcquired" : ""}">
      <div class="demoTokenImage">${symbol.slice(0, 1)}</div>
      <div class="demoIdentity"><strong>${name}</strong><span>$${symbol}</span></div>
      <div class="demoMarket"><span>Market cap</span><strong>$${acquired ? "42.8K" : "18.6K"}</strong></div>
      <div class="demoLock"><span>${acquired ? "Position open" : "Target lock"}</span><strong>${score}%</strong><i><b style="width:${score}%"></b></i></div>
    </article>`;
  return wrapper;
}

export function LaunchMotionController() {
  const previous = useRef<Map<string, CardSnapshot>>(new Map());

  useEffect(() => {
    previous.current = cardsOnBoard();
    const board = document.querySelector(".launchBoard");
    if (!board) return;

    let queued = 0;
    const compare = () => {
      queued = 0;
      const current = cardsOnBoard();

      current.forEach((next, token) => {
        const prior = previous.current.get(token);
        if (prior?.state === "sighted" && next.state === "under_watch") {
          animate(next.element, "motionFromSighted");
        }
        if (prior?.state === "under_watch" && next.state === "target_locked") {
          animate(next.element, "motionAcquired", 1_250);
        }
      });

      previous.current.forEach((prior, token) => {
        if (!current.has(token) && prior.state === "sighted") {
          const ageMinutes = prior.launchedAt ? (Date.now() - prior.launchedAt) / 60_000 : 999;
          if (ageMinutes < 55) createBinnedGhost(prior);
        }
      });

      previous.current = current;
    };

    const observer = new MutationObserver(() => {
      window.clearTimeout(queued);
      queued = window.setTimeout(compare, 90);
    });
    observer.observe(board, { childList: true, subtree: true });

    const preview = () => {
      document.querySelectorAll(".launchAnimationDemo").forEach((element) => element.remove());
      document.querySelectorAll<HTMLElement>(".launchLane .laneEmpty").forEach((element) => { element.dataset.demoHidden = "true"; element.style.display = "none"; });

      const sightedLane = board.querySelector<HTMLElement>(".launchLane.new .launchLaneBody");
      const watchedLane = board.querySelector<HTMLElement>(".launchLane.completing .launchLaneBody");
      const acquiredLane = board.querySelector<HTMLElement>(".launchLane.completed .launchLaneBody");
      if (!sightedLane || !watchedLane || !acquiredLane) return;

      const binnedDemo = createDemoCard("Rejected launch", "BIN", 23);
      const promotedDemo = createDemoCard("Fast flow", "FLOW", 72);
      sightedLane.prepend(promotedDemo);
      sightedLane.prepend(binnedDemo);
      animate(binnedDemo, "motionBinned");
      window.setTimeout(() => binnedDemo.remove(), 1_100);
      window.setTimeout(() => {
        animate(promotedDemo, "motionToSurveillance");
      }, 1_300);
      window.setTimeout(() => {
        promotedDemo.remove();
        const watchedDemo = createDemoCard("Fast flow", "FLOW", 91);
        watchedLane.prepend(watchedDemo);
        animate(watchedDemo, "motionFromSighted");
        window.setTimeout(() => animate(watchedDemo, "motionToAcquired"), 1_350);
        window.setTimeout(() => {
          watchedDemo.remove();
          const acquiredDemo = createDemoCard("Fast flow", "FLOW", 100, true);
          acquiredLane.prepend(acquiredDemo);
          animate(acquiredDemo, "motionAcquired", 1_250);
        }, 2_050);
      }, 2_050);
      window.setTimeout(() => {
        document.querySelectorAll(".launchAnimationDemo").forEach((element) => element.remove());
        document.querySelectorAll<HTMLElement>('.launchLane .laneEmpty[data-demo-hidden="true"]').forEach((element) => { element.style.removeProperty("display"); delete element.dataset.demoHidden; });
      }, 5_500);
    };

    window.addEventListener("ponseye:test-transitions", preview);
    return () => {
      window.clearTimeout(queued);
      observer.disconnect();
      window.removeEventListener("ponseye:test-transitions", preview);
    };
  }, []);

  return null;
}

export function LaunchMotionPreview() {
  const [running, setRunning] = useState(false);

  function runPreview() {
    if (running) return;
    setRunning(true);
    document.querySelector<HTMLDetailsElement>(".pixelMenu")?.removeAttribute("open");
    window.dispatchEvent(new Event("ponseye:test-transitions"));
    window.setTimeout(() => setRunning(false), 5_600);
  }

  return (
    <button className="pixelMenuDemo" type="button" onClick={runPreview} disabled={running}>
      <span>{running ? "Testing transitions" : "Test animations"}</span>
      <i aria-hidden="true">{running ? "•••" : "▶"}</i>
    </button>
  );
}
