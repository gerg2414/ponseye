const trustedImageHosts = new Set([
  "gmgn.ai",
  "j7m.io",
  "img.koyen.fun",
  "axiom-rh-v2.axiom-cdn.io",
  "axiomtrading-v2.axiom-cdn.io",
  "m.rapidlaunch.io",
]);

function ipfsCid(value: string | null) {
  if (!value) return null;
  const raw = value.trim();
  let candidate = raw.split(/[?#]/, 1)[0];

  try {
    const url = new URL(raw);
    if (url.protocol === "ipfs:") candidate = url.hostname || url.pathname.split("/").filter(Boolean)[0] || "";
    if (url.protocol === "https:") {
      const parts = url.pathname.split("/").filter(Boolean);
      const ipfsIndex = parts.indexOf("ipfs");
      if (ipfsIndex >= 0) candidate = parts[ipfsIndex + 1] ?? "";
    }
  } catch {
    candidate = candidate.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "").split("/")[0];
  }

  return /^(?:Qm[1-9A-HJ-NP-Za-km-z]{40,}|baf[a-z0-9]{20,})$/i.test(candidate) ? candidate : null;
}

export function safeImageUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && trustedImageHosts.has(url.hostname.toLowerCase()) ? value : null;
  } catch {
    return null;
  }
}

export function imageCandidates(value: string | null) {
  const cid = ipfsCid(value);
  if (cid) return [`/api/token-image/${encodeURIComponent(cid)}`];

  const safe = safeImageUrl(value);
  if (!safe) return [];

  try {
    const url = new URL(safe);
    return [`/api/token-image/source?url=${encodeURIComponent(safe)}`, safe];
  } catch {
    return [];
  }
}
