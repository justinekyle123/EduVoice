import type { NextConfig } from "next";

// GitHub Codespaces & VS Code Tunnels forward ports through their own domains,
// so the browser's `Origin` never matches the `Host` Next.js sees inside the
// container. Per the Next.js docs, the tunnel hostname belongs in both places:
//  - allowedDevOrigins: lets the dev server serve assets/endpoints to it
//  - experimental.serverActions.allowedOrigins: accepts server actions from it
// (e.g. Clerk sign-out) instead of aborting with "Invalid Server Actions
// request." Wildcards use remotePatterns syntax (* = one label, ** = many).
// Production config is untouched — origins match the host on Vercel.
const tunnelOrigins = [
  "*.app.github.dev", // GitHub Codespaces
  "*.githubpreview.dev", // older Codespaces domains
  "*.devtunnels.ms", // VS Code Tunnels
];

const nextConfig: NextConfig = {
  allowedDevOrigins: tunnelOrigins,
  experimental:
    process.env.NODE_ENV === "development"
      ? {
          serverActions: {
            allowedOrigins: tunnelOrigins,
          },
        }
      : undefined,
};

export default nextConfig;