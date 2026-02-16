import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, useSession } = authClient;

/** Callback URL after login/signup: production uses VITE_SITE_URL, dev uses current origin (e.g. localhost). */
export function getLoginCallbackUrl(): string {
  const base =
    (import.meta.env.VITE_SITE_URL as string | undefined) || window.location.origin;
  return `${base.replace(/\/$/, "")}/app`;
}
