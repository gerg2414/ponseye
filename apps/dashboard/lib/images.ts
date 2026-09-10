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
