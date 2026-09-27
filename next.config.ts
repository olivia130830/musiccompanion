import type { NextConfig } from "next";

const authBackendUrl =
  process.env.AUTH_BACKEND_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/auth-api/:path*",
        destination: `${authBackendUrl}/auth-api/:path*`,
      },
    ];
  },
};

export default nextConfig;
