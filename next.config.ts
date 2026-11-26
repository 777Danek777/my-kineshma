import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Social crawlers must receive complete Open Graph tags in the initial HTML head.
  htmlLimitedBots: /.*/,
  outputFileTracingExcludes: { "/*": ["./storage/**/*", "./.env*"] },
  outputFileTracingIncludes: { "/api/*": ["./scripts/media-probe-worker.mjs", "./node_modules/mediainfo.js/**/*"] },
  images: {
    // Authenticated media must never enter Next.js's public image cache.
    localPatterns: [{ pathname: "/images/**", search: "" }],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
