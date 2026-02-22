import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// Get base URL from env or fallback to current origin
const getBaseURL = () => {
  const envUrl = import.meta.env.VITE_SITE_URL as string | undefined;
  if (envUrl) return envUrl;
  return window.location.origin;
};

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, useSession } = authClient;

/** Callback URL after login/signup.
 * - Production: use VITE_SITE_URL (canonical app URL, e.g. https://unlockaffiliate.com)
 * - Dev / fallback: use current browser origin (e.g. http://localhost:5173)
 */
export function getLoginCallbackUrl(): string {
  const base = getBaseURL();
  return `${base.replace(/\/$/, "")}/app`;
}
