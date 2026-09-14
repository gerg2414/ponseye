"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { imageCandidates } from "../lib/images";

/**
 * The first character to show while an image loads.
 *
 * charAt(0) splits a surrogate pair, so a name beginning with an emoji yielded a
 * lone surrogate. That is not valid text, and the server and the client encode
 * it differently, which broke hydration for the whole table. Prefer the first
 * letter or digit, which is what actually reads as an initial, and fall back to
 * the first whole code point.
 */
function initialOf(value: string) {
  const characters = Array.from(value.trim());
  const alphanumeric = characters.find((character) => /\p{L}|\p{N}/u.test(character));
  return (alphanumeric ?? characters[0] ?? "?").toUpperCase();
}

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
  const [candidateIndex, setCandidateIndex] = useState(0);
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

    // Avoid starting several remote image requests for cards outside the viewport.
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [priority, src]);

  useEffect(() => {
    setCandidateIndex(0);
    setLoaded(false);
  }, [candidates]);

  const resolvedSrc = shouldLoad ? candidates[candidateIndex] ?? null : null;

  return (
    <span ref={host} className="tokenImageLoader">
      <span aria-hidden="true" className="tokenImageInitial">{initialOf(alt)}</span>
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
          onError={() => {
            setLoaded(false);
            setCandidateIndex((current) => current + 1);
          }}
        />
      ) : null}
    </span>
  );
}
