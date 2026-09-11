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
      const sighted = [...document.querySelectorAll<HTMLElement>('.launchCardLink[data-state="sighted"]')];
      const watched = [...document.querySelectorAll<HTMLElement>('.launchCardLink[data-state="under_watch"]')];
      const acquired = [...document.querySelectorAll<HTMLElement>('.launchCardLink[data-state="target_locked"]')];

      animate(sighted[0] ?? null, "motionBinned");
      window.setTimeout(() => {
        animate(sighted[1] ?? sighted[0] ?? null, "motionToSurveillance");
        animate(watched[0] ?? null, "motionFromSighted");
      }, 1_300);
      window.setTimeout(() => {
        animate(watched[1] ?? watched[0] ?? null, "motionToAcquired");
        animate(acquired[0] ?? null, "motionAcquired", 1_250);
      }, 2_750);
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
    window.dispatchEvent(new Event("ponseye:test-transitions"));
    window.setTimeout(() => setRunning(false), 4_300);
  }

  return (
    <button className="pixelMenuDemo" type="button" onClick={runPreview} disabled={running}>
      <span>{running ? "Testing transitions" : "Test animations"}</span>
      <i aria-hidden="true">{running ? "•••" : "▶"}</i>
    </button>
  );
}
