import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Protect the dashboard (and any future /app routes). Everything else is public.
const isProtectedRoute = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  // Only redirect page navigations (GET). Server-action POSTs — like Clerk's
  // sign-out action, which clears the session cookie — must pass through
  // untouched: redirecting them makes Next.js throw "Invalid Server Actions
  // request." The dashboard page re-checks auth() itself, so GET-only
  // protection is still safe.
  if (isProtectedRoute(req) && req.method === "GET") {
    await auth.protect();
  }
});

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