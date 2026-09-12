"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { imageCandidates } from "../lib/images";

export function TokenImage({
  src,
  alt,
  size,
  priority = false,
}: {
  src: string | null;
  alt: string;
  size: number;
  priority?: boolean;
}) {
  const candidates = useMemo(() => imageCandidates(src), [src]);
  const host = useRef<HTMLSpanElement>(null);
  const [shouldLoad, setShouldLoad] = useState(priority);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (priority) {
      setShouldLoad(true);
      return;
    }

    const element = host.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [priority, src]);

  useEffect(() => {
    setResolvedSrc(null);
    setLoaded(false);
    if (!shouldLoad || !candidates.length) return;

    let active = true;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const loaders: HTMLImageElement[] = [];
    const start = (candidate: string) => {
      if (!active) return;
      const loader = new window.Image();
      loader.decoding = "async";
      loader.onload = () => {
        if (active && loader.naturalWidth > 0) setResolvedSrc((current) => current ?? candidate);
      };
      loader.src = candidate;
      loaders.push(loader);
    };

    const delays = [0, 300, 900, 1_800, 3_000];
    candidates.forEach((candidate, index) => {
      if (index === 0) start(candidate);
      else timers.push(setTimeout(() => start(candidate), delays[index] ?? index * 900));
    });

    return () => {
      active = false;
      timers.forEach(clearTimeout);
      loaders.forEach((loader) => {
        loader.onload = null;
        loader.onerror = null;
      });
    };
  }, [candidates, shouldLoad]);

  return (
    <span ref={host} className="tokenImageLoader">
      <span aria-hidden="true" className="tokenImageInitial">{alt.trim().charAt(0).toUpperCase() || "?"}</span>
      {resolvedSrc ? (
        <Image
          key={resolvedSrc}
          src={resolvedSrc}
          alt={alt}
          width={size}
          height={size}
          priority={priority}
          unoptimized
          sizes={`${size}px`}
          style={{ opacity: loaded ? 1 : 0, transition: "opacity 120ms ease-out" }}
          onLoad={() => setLoaded(true)}
        />
      ) : null}
    </span>
  );
}
