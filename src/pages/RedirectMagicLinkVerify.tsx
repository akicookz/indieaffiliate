import { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";

/**
 * Handles old magic-link emails that pointed to /api/auth/magic-link/verify.
 * Redirects to /verify-login?token=... so the app route can verify and send the user to /portal.
 * If no token, redirects to partner login.
 */
export default function RedirectMagicLinkVerify() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  useEffect(() => {
    if (token) {
      navigate(`/verify-login?token=${encodeURIComponent(token)}`, {
        replace: true,
      });
    } else {
      navigate("/partner-login", { replace: true });
    }
  }, [token, navigate]);

  return null;
}
