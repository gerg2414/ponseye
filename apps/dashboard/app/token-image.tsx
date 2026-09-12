"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
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
  const current = candidates[candidateIndex];

  useEffect(() => {
    setCandidateIndex(0);
    setLoaded(false);
  }, [src]);

  if (!current) return <span aria-hidden="true">?</span>;

  return (
    <Image
      key={current}
      src={current}
      alt={alt}
      width={size}
      height={size}
      priority={priority}
      unoptimized={current.startsWith("/api/token-image/")}
      sizes={`${size}px`}
      style={{ opacity: loaded ? 1 : 0, transition: "opacity 120ms ease-out" }}
      onLoad={() => setLoaded(true)}
      onError={() => {
        setLoaded(false);
        setCandidateIndex((index) => index + 1);
      }}
    />
  );
}
