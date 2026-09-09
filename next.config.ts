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

// VS Code's "Simple Browser" preview loads the app at http://localhost:<port>
// while the Codespaces proxy forwards those requests with `x-forwarded-host`
// set to the public *.app.github.dev URL. The server-action CSRF check compares
// the browser `Origin` against that forwarded host, so the localhost origin
// must be allowed explicitly (remotePatterns syntax can't wildcard the port).
const localDevOrigins = [
  "localhost:3000",
  "127.0.0.1:3000",
  "localhost:3001", // when 3000 is taken, next dev auto-increments
  "127.0.0.1:3001",
];

const nextConfig: NextConfig = {
  allowedDevOrigins: [...tunnelOrigins, ...localDevOrigins],
  experimental:
    process.env.NODE_ENV === "development"
      ? {
          serverActions: {
            allowedOrigins: [...tunnelOrigins, ...localDevOrigins],
          },
        }
      : undefined,
};

export default nextConfig;