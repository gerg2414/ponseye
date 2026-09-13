import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "gmgn.ai", pathname: "/external-res/**" },
    ],
  },
};

export default nextConfig;
