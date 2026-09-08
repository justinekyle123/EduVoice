import { clerkMiddleware } from "@clerk/nextjs/server";

// Route protection is resource-based: the (dashboard) layout calls auth() and
// redirects unauthenticated users, which is Clerk's recommended pattern.
// clerkMiddleware stays here only to hydrate the session and keep Clerk's
// frontend API routes working. It never redirects requests, so server-action
// POSTs (e.g. Clerk sign-out) always pass through untouched.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Always run for Clerk-specific frontend API routes
    "/__clerk/(.*)",
  ],
};