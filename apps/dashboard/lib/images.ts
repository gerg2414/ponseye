export function safeImageUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const isGmgnArtwork = url.hostname === "gmgn.ai" && url.pathname.startsWith("/external-res/");
    return url.protocol === "https:" && isGmgnArtwork ? value : null;
  } catch {
    return null;
  }
}

export function imageCandidates(value: string | null) {
  const safe = safeImageUrl(value);
  if (!safe) return [];

  try {
    const url = new URL(safe);
    return [`/api/token-image/source?url=${encodeURIComponent(safe)}`, safe];
  } catch {
    return [];
  }
}
