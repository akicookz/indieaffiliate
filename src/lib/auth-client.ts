import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// Single source: BETTER_AUTH_URL from vite config (VITE_BETTER_AUTH_URL)
const getBaseURL = (): string =>
  (import.meta.env.VITE_BETTER_AUTH_URL as string | undefined) ?? window.location.origin;

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, useSession } = authClient;

/** Callback path after login/signup. Server resolves against its baseURL (BETTER_AUTH_URL). */
export function getLoginCallbackUrl(): string {
  return "/app";
}
