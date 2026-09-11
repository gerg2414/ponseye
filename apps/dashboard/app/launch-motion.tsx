"use client";

import { useEffect, useRef, useState } from "react";

type CardState = "sighted" | "under_watch" | "target_locked";

type CardSnapshot = {
  element: HTMLElement;
  launchedAt: number;
  rect: DOMRect;
  state: CardState;
};

const animationLength = 1_050;
const binnedLength = 780;

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
      rect: element.getBoundingClientRect(),
    });
  });
  return cards;
}

function createBinnedGhost(snapshot: CardSnapshot) {
  const rect = snapshot.rect;
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
  animate(ghost, "motionBinned", binnedLength);
  window.setTimeout(() => ghost.remove(), binnedLength + 80);
}

function flySnapshot(prior: CardSnapshot, next: CardSnapshot, tone: "purple" | "green") {
  if (!prior.rect.width || !next.rect.width) return;
  const ghost = prior.element.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("href");
  ghost.className = `launchCardLink motionGhost flightGhost ${tone}`;
  Object.assign(ghost.style, {
    left: `${prior.rect.left}px`, top: `${prior.rect.top}px`, width: `${prior.rect.width}px`, height: `${prior.rect.height}px`,
  });
  next.element.style.visibility = "hidden";
  document.body.appendChild(ghost);
  const dx = next.rect.left - prior.rect.left;
  const dy = next.rect.top - prior.rect.top;
  ghost.animate([
    { transform: "translate3d(0,0,0) scale(1)", opacity: 1 },
    { transform: `translate3d(${dx * .48}px,${dy * .2 - 8}px,0) scale(1.018)`, opacity: 1, offset: .48 },
    { transform: `translate3d(${dx}px,${dy}px,0) scale(1)`, opacity: 1 },
  ], { duration: 880, easing: "cubic-bezier(.22,.74,.2,1)", fill: "forwards" }).finished.then(() => {
    ghost.remove();
    next.element.style.removeProperty("visibility");
    keepArrivalOnTop(next.element);
    animate(next.element, tone === "green" ? "motionAcquired" : "motionFromSighted", tone === "green" ? 1_250 : 760);
  }).catch(() => {
    ghost.remove();
    next.element.style.removeProperty("visibility");
  });
}

function removeAndSlideUp(element: HTMLElement) {
  const lane = element.parentElement;
  if (!lane) { element.remove(); return; }
  const remaining = [...lane.children].filter((item): item is HTMLElement => item instanceof HTMLElement && item !== element);
  const before = new Map(remaining.map((item) => [item, item.getBoundingClientRect().top]));
  element.remove();
  remaining.forEach((item) => {
    const delta = (before.get(item) ?? 0) - item.getBoundingClientRect().top;
    if (Math.abs(delta) > 1) item.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], { duration: 430, easing: "cubic-bezier(.2,.76,.24,1)" });
  });
}

function keepArrivalOnTop(element: HTMLElement, duration = 900) {
  element.classList.add("motionArrivalTop");
  window.setTimeout(() => element.classList.remove("motionArrivalTop"), duration);
}

function prependAndSlideDown(lane: HTMLElement, element: HTMLElement) {
  const existing = [...lane.children].filter((item): item is HTMLElement => item instanceof HTMLElement);
  const before = new Map(existing.map((item) => [item, item.getBoundingClientRect().top]));
  lane.prepend(element);
  keepArrivalOnTop(element);
  existing.forEach((item) => {
    const delta = (before.get(item) ?? 0) - item.getBoundingClientRect().top;
    if (Math.abs(delta) > 1) item.animate([
      { transform: `translateY(${delta}px)` },
      { transform: "translateY(0)" },
    ], { duration: 520, easing: "cubic-bezier(.2,.76,.24,1)" });
  });
}

function flyDemoCard(element: HTMLElement, destination: HTMLElement, tone: "purple" | "green", onArrival: () => void) {
  const start = element.getBoundingClientRect();
  const targetLane = destination.getBoundingClientRect();
  const targetTop = targetLane.top + 10;
  const targetLeft = targetLane.left + 10;
  const ghost = element.cloneNode(true) as HTMLElement;
  ghost.className = `launchCardLink motionGhost flightGhost ${tone}`;
  Object.assign(ghost.style, { left: `${start.left}px`, top: `${start.top}px`, width: `${start.width}px`, height: `${start.height}px` });
  element.style.visibility = "hidden";
  document.body.appendChild(ghost);
  ghost.animate([
    { transform: "translate3d(0,0,0) scale(1)", opacity: 1 },
    { transform: `translate3d(${(targetLeft - start.left) * .5}px,-10px,0) scale(1.025)`, opacity: 1, offset: .5 },
    { transform: `translate3d(${targetLeft - start.left}px,${targetTop - start.top}px,0) scale(1)`, opacity: 1 },
  ], { duration: 920, easing: "cubic-bezier(.2,.72,.18,1)", fill: "forwards" }).finished.then(() => {
    ghost.remove();
    removeAndSlideUp(element);
    onArrival();
  }).catch(() => { ghost.remove(); removeAndSlideUp(element); onArrival(); });
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
        if (prior && prior.state === next.state) {
          const delta = prior.rect.top - next.rect.top;
          if (Math.abs(delta) > 1) next.element.animate([
            { transform: `translateY(${delta}px)` },
            { transform: "translateY(0)" },
          ], { duration: 520, easing: "cubic-bezier(.2,.76,.24,1)" });
        }
        if (prior?.state === "sighted" && next.state === "under_watch") {
          flySnapshot(prior, next, "purple");
        }
        if (prior?.state === "under_watch" && next.state === "target_locked") {
          flySnapshot(prior, next, "green");
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
      [binnedDemo, promotedDemo, createDemoCard("Night watch", "NITE", 61), createDemoCard("Robin run", "ROBN", 47), createDemoCard("Early bird", "BIRD", 35)].forEach((card) => sightedLane.append(card));
      [createDemoCard("Vector", "VCTR", 84), createDemoCard("Purple eye", "EYE", 78), createDemoCard("Lockstep", "LOCK", 69), createDemoCard("Scout", "SCT", 58)].forEach((card) => watchedLane.append(card));
      [createDemoCard("Runner one", "RUN", 100, true), createDemoCard("Orbit", "ORBT", 100, true), createDemoCard("Vaulted", "VLT", 100, true)].forEach((card) => acquiredLane.append(card));

      animate(binnedDemo, "motionBinned", binnedLength);
      window.setTimeout(() => removeAndSlideUp(binnedDemo), binnedLength);
      window.setTimeout(() => {
        flyDemoCard(promotedDemo, watchedLane, "purple", () => {
          const watchedDemo = createDemoCard("Fast flow", "FLOW", 91);
          prependAndSlideDown(watchedLane, watchedDemo);
          animate(watchedDemo, "motionFromSighted", 760);
          window.setTimeout(() => {
            flyDemoCard(watchedDemo, acquiredLane, "green", () => {
              const acquiredDemo = createDemoCard("Fast flow", "FLOW", 100, true);
              prependAndSlideDown(acquiredLane, acquiredDemo);
              animate(acquiredDemo, "motionAcquired", 1_050);
            });
          }, 1_250);
        });
      }, 1_250);
      window.setTimeout(() => {
        document.querySelectorAll(".launchAnimationDemo").forEach((element) => element.remove());
        document.querySelectorAll<HTMLElement>('.launchLane .laneEmpty[data-demo-hidden="true"]').forEach((element) => { element.style.removeProperty("display"); delete element.dataset.demoHidden; });
      }, 5_800);
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
    window.setTimeout(() => setRunning(false), 5_900);
  }

  return (
    <button className="pixelMenuDemo" type="button" onClick={runPreview} disabled={running}>
      <span>{running ? "Testing transitions" : "Test animations"}</span>
      <i aria-hidden="true">{running ? "•••" : "▶"}</i>
    </button>
  );
}
