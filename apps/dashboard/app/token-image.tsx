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
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = candidates[candidateIndex];

  useEffect(() => {
    setCandidateIndex(0);
    setLoaded(false);
  }, [src]);

  useEffect(() => {
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    if (!current || loaded || candidateIndex >= candidates.length - 1) return;

    fallbackTimer.current = setTimeout(() => {
      setLoaded(false);
      setCandidateIndex((index) => index + 1);
    }, 900);

    return () => {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    };
  }, [candidateIndex, candidates.length, current, loaded]);

  if (!current) return <span aria-hidden="true">?</span>;

  return (
    <Image
      key={current}
      src={current}
      alt={alt}
      width={size}
      height={size}
      priority={priority}
      unoptimized={current.includes("/ipfs/")}
      sizes={`${size}px`}
      style={{ opacity: loaded ? 1 : 0, transition: "opacity 120ms ease-out" }}
      onLoad={() => {
        if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
        setLoaded(true);
      }}
      onError={() => {
        setLoaded(false);
        setCandidateIndex((index) => index + 1);
      }}
    />
  );
}
