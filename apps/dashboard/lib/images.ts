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
  "axiom-rh-v2.axiom-cdn.io",
  "d.uguu.se",
  "cloudflare-ipfs.com",
  "dweb.link",
  "nftstorage.link",
  "w3s.link",
  "gateway.lighthouse.storage",
  "edge.uxento.io",
  "cdn.corenexis.com",
  "46-225-60-163.sslip.io",
  "char.autos",
  "en.wikipedia.org",
  "fast-ipfs.com",
  "ipfs.launchblitz.ai",
  "pons-avatar-cdn.carlitolhargraveslra.chatgpt.site",
  "uplift.cash",
]);

export function safeImageUrl(value: string | null) {
  if (!value) return null;
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/.test(value)) {
    return `https://ipfs.io/ipfs/${value}`;
  }
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
    if (!match) return [safe, `/api/token-image/source?url=${encodeURIComponent(safe)}`];
    const path = match[1];
    return [...new Set([
      `https://w3s.link/ipfs/${path}`,
      `https://nftstorage.link/ipfs/${path}`,
      `https://gateway.pinata.cloud/ipfs/${path}`,
      `https://dweb.link/ipfs/${path}`,
      `https://ipfs.io/ipfs/${path}`,
      `https://cloudflare-ipfs.com/ipfs/${path}`,
      `https://gateway.lighthouse.storage/ipfs/${path}`,
      safe,
    ])];
  } catch {
    return [];
  }
}
