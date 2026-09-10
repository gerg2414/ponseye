const imageHosts = new Set([
  "ipfs.io",
  "gateway.pinata.cloud",
  "gmgn.ai",
  "pbs.twimg.com",
  "img.koyen.fun",
  "m.rapidlaunch.io",
  "j7m.io",
  "unavatar.io",
  "www.copybara.run",
  "i.postimg.cc",
  "axiomtrading-v2.axiom-cdn.io",
  "d.uguu.se",
  "cloudflare-ipfs.com",
  "dweb.link",
]);

export function safeImageUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && imageHosts.has(url.hostname) ? value : null;
  } catch {
    return null;
  }
}

export function imageCandidates(value: string | null) {
  const safe = safeImageUrl(value);
  if (!safe) return [];

  try {
    const url = new URL(safe);
    const match = url.pathname.match(/^\/ipfs\/(.+)$/);
    if (!match) return [safe];
    const path = match[1];
    return [
      `https://ipfs.io/ipfs/${path}`,
      `https://gateway.pinata.cloud/ipfs/${path}`,
      `https://cloudflare-ipfs.com/ipfs/${path}`,
      `https://dweb.link/ipfs/${path}`,
    ];
  } catch {
    return [];
  }
}
