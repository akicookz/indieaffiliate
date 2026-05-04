import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

type CallbackStatus = "loading" | "error";

function AuthCallback() {
    const { provider } = useParams();

    const [status, setStatus] = useState<CallbackStatus>("loading");
    const [errorMessage, setErrorMessage] = useState<string>("");

    useEffect(() => {
        let cancelled = false;

        function redirectToApp() {
            window.location.replace("/app");
        }

        async function hasSession(): Promise<boolean> {
            try {
                const response = await fetch("/api/auth/get-session", {
                    method: "GET",
                    credentials: "include",
                    headers: {
                        Accept: "application/json",
                    },
                });

                if (!response.ok) return false;
                const data: unknown = await response.json();
                if (!data || typeof data !== "object") return false;
                return "session" in data && "user" in data;
            } catch {
                return false;
            }
        }

        async function complete() {
            if (!provider) {
                setStatus("error");
                setErrorMessage("Missing OAuth provider in callback URL.");
                return;
            }

            const currentUrl = new URL(window.location.href);
            const stateParam = currentUrl.searchParams.get("state") ?? "";
            const storageKey = stateParam
                ? `ia.oauth.callback:${provider}:${stateParam}`
                : `ia.oauth.callback:${provider}:no_state`;

            // If we already have a valid session, don't try to consume state again.
            if (await hasSession()) {
                sessionStorage.setItem(storageKey, "done");
                redirectToApp();
                return;
            }

            const alreadyAttempted = sessionStorage.getItem(storageKey);
            if (alreadyAttempted === "done") {
                redirectToApp();
                return;
            }

            // Mark that we attempted this state once. (Prevents StrictMode/double-effects from calling twice.)
            sessionStorage.setItem(storageKey, "attempted");

            try {
                const response = await fetch(window.location.href, {
                    method: "GET",
                    credentials: "include",
                    // Some dev setups route HTML navigations to the SPA. Use a non-HTML Accept header
                    // to increase the chance this request reaches the Worker auth handler.
                    headers: {
                        Accept: "application/json",
                    },
                });

                const finalUrl = response.url ? new URL(response.url) : null;

                if (cancelled) return;

                // If Better Auth redirected us to an error endpoint:
                if (finalUrl?.pathname.startsWith("/api/auth/error")) {
                    const error = finalUrl.searchParams.get("error") ?? "unknown_error";
                    const description = finalUrl.searchParams.get("error_description") ?? "";

                    // This commonly happens if the callback was already processed (state is one-time-use),
                    // but the user is still signed in. Prefer redirecting to the app if a session exists.
                    if (error === "please_restart_the_process" || error === "state_mismatch") {
                        if (await hasSession()) {
                            sessionStorage.setItem(storageKey, "done");
                            redirectToApp();
                            return;
                        }
                    }

                    throw new Error(
                        description ? `${error}: ${description}` : `Auth error: ${error}`,
                    );
                }

                // If we ended up on the same callback URL, the request likely never hit the auth handler.
                if (finalUrl?.pathname.startsWith("/api/auth/callback")) {
                    if (await hasSession()) {
                        sessionStorage.setItem(storageKey, "done");
                        redirectToApp();
                        return;
                    }
                    throw new Error(
                        "Auth callback did not complete. The backend auth handler may not have received this request.",
                    );
                }

                sessionStorage.setItem(storageKey, "done");
                redirectToApp();
            } catch (err) {
                if (cancelled) return;

                // If we got a state-related error but the session is already established, just continue.
                if (await hasSession()) {
                    sessionStorage.setItem(storageKey, "done");
                    redirectToApp();
                    return;
                }

                setStatus("error");
                setErrorMessage(
                    err instanceof Error ? err.message : "An unexpected error occurred.",
                );
            }
        }

        // React StrictMode runs effects twice in dev. Defer starting the callback request so the
        // first (test) effect run can be cleaned up before doing any real work.
        const timeoutId = window.setTimeout(() => {
            void complete();
        }, 0);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [provider]);

    return (
        <div className="min-h-screen bg-background flex items-center justify-center px-4">
            <Card className="w-full max-w-md rounded-md bg-card border-border/50">
                <CardHeader className="text-center">
                    <CardTitle className="text-xl">
                        {status === "loading" ? "Signing you in" : "Sign-in failed"}
                    </CardTitle>
                    <CardDescription>
                        {status === "loading"
                            ? "Finishing authentication…"
                            : "We couldn’t complete your sign-in."}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {status === "loading" ? (
                        <div
                            className="flex items-center justify-center gap-3 text-sm text-muted-foreground"
                            role="status"
                            aria-live="polite"
                            aria-busy="true"
                        >
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Please wait. You’ll be redirected shortly.</span>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-start gap-3 rounded-md border border-border/60 bg-background/40 p-4">
                                <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                                <div className="space-y-1">
                                    <div className="text-sm font-medium">Error</div>
                                    <div className="text-sm text-muted-foreground break-words">
                                        {errorMessage || "Unknown error"}
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                <Button asChild className="w-full">
                                    <Link to="/login" replace>
                                        Back to login
                                    </Link>
                                </Button>
                                <Button asChild variant="secondary" className="w-full">
                                    <a href={window.location.href}>Retry callback</a>
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

export default AuthCallback;

