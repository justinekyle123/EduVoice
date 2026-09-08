import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GitHub Codespaces & VS Code Tunnels forward ports through their own
  // domains, so the browser's `Origin` header never matches the `Host` that
  // Next.js sees inside the container. That mismatch makes Next.js abort
  // every server action (e.g. Clerk sign-out) with "Invalid Server Actions
  // request." Allowlist those dev domains here — wildcards are supported,
  // with the same syntax as next/image remotePatterns. Production is
  // unaffected: origins match the host on Vercel.
  serverActions:
    process.env.NODE_ENV === "development"
      ? {
          allowedOrigins: [
            "*.app.github.dev", // GitHub Codespaces
            "*.githubpreview.dev", // older Codespaces domains
            "*.devtunnels.ms", // VS Code Tunnels
          ],
        }
      : undefined,
};

export default nextConfig;