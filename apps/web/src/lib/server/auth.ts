import { betterAuth, type BetterAuthOptions } from "better-auth";
import { dbConfigured, getPool } from "./db";

// Google sign-in through Better Auth, as in capsule and freewrite. Sync is off until the database
// and auth secrets are configured; stash still works as a guest library in the browser.

let instance: ReturnType<typeof betterAuth> | null = null;

export function authConfigured(): boolean {
  return dbConfigured() && Boolean(process.env.BETTER_AUTH_SECRET) && googleConfigured();
}

function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function getAuth() {
  if (!authConfigured()) return null;
  if (!instance) {
    const options: BetterAuthOptions = {
      appName: "stash",
      database: getPool(),
      secret: process.env.BETTER_AUTH_SECRET,
      baseURL: process.env.BETTER_AUTH_URL,
      socialProviders: {
        google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! },
      },
    };
    instance = betterAuth(options);
  }
  return instance;
}

/** The deployment's own origin, for rejecting cross-site requests. */
export function appOrigin(request: Request): string {
  return process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL).origin : new URL(request.url).origin;
}

/** Browsers send Origin on cross-site POSTs; a request from another site is refused. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === appOrigin(request);
}
