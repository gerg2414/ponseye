import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "ipfs.io" },
      { protocol: "https", hostname: "gateway.pinata.cloud" },
      { protocol: "https", hostname: "gmgn.ai" },
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "img.koyen.fun" },
      { protocol: "https", hostname: "m.rapidlaunch.io" },
      { protocol: "https", hostname: "j7m.io" },
      { protocol: "https", hostname: "unavatar.io" },
      { protocol: "https", hostname: "www.copybara.run" },
      { protocol: "https", hostname: "i.postimg.cc" },
      { protocol: "https", hostname: "axiomtrading-v2.axiom-cdn.io" },
    ],
  },
};

export default nextConfig;
