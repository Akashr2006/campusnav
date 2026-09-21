import type { NextConfig } from "next";
import path from "path";

const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self)",
  },
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname),
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // `.data/` holds the local campus store, which the admin panel rewrites on
      // every autosave. It lives inside the project, so without this the dev
      // watcher treats each save as a source change and rebuilds.
      const ignored = [
        "**/node_modules/**",
        "**/.git/**",
        "**/.next/**",
        "**/.data/**",
        "**/backup/**",
        "**/*.log",
      ];
      config.watchOptions = {
        ...(config.watchOptions ?? {}),
        ignored,
      };
    }
    return config;
  },
};

export default nextConfig;
