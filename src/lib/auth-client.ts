import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, useSession } = authClient;

/** Callback URL after login/signup.
 * - Production: use VITE_SITE_URL (canonical app URL, e.g. https://unlockaffiliate.com)
 * - Dev / fallback: use current browser origin (e.g. http://localhost:5173)
 */
export function getLoginCallbackUrl(): string {
  const base =
    (import.meta.env.VITE_SITE_URL as string | undefined) || window.location.origin;
  return `${base.replace(/\/$/, "")}/app`;
}
