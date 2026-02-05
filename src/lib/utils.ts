import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Generate the tracking snippet that site owners paste into their <head>.
 * Hardened against: unhandled rejections, ref injection, HTTP-only sites,
 * and navigation-cancelled requests.
 */
export function generateTrackingSnippet(baseUrl: string): string {
  return `<script>
(function() {
  var ref = new URLSearchParams(window.location.search).get('ref');
  if (ref && /^[a-zA-Z0-9_-]+$/.test(ref)) {
    document.cookie = '__ia_ref=' + ref + ';path=/;max-age=' + (30*24*60*60) + ';SameSite=Lax' + (location.protocol === 'https:' ? ';Secure' : '');
    fetch('${baseUrl}/api/track/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referralCode: ref, landingPage: window.location.href }),
      keepalive: true
    }).catch(function() {});
  }
})();
</script>`;
}
