/**
 * Stripe webhook signature verification and helpers.
 * Stripe sends header: stripe-signature = "t=timestamp,v1=hex_signature" (or v0).
 * Payload to verify: HMAC-SHA256(webhook_secret, "timestamp.rawBody")
 */

export async function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
): Promise<boolean> {
  if (!signatureHeader || !webhookSecret) return false;

  const parts = signatureHeader.split(",").reduce(
    (acc, part) => {
      const [k, v] = part.split("=");
      if (k && v) acc[k.trim()] = v.trim();
      return acc;
    },
    {} as Record<string, string>,
  );
  const timestamp = parts["t"];
  const v1 = parts["v1"];
  if (!timestamp || !v1) return false;

  const payload = `${timestamp}.${rawBody}`;
  return verifyHmacSha256Hex(webhookSecret, payload, v1);
}

/**
 * HMAC-SHA256 of payload with secret, compare to hex-encoded expected signature.
 * Uses Web Crypto API (Cloudflare Workers compatible).
 */
async function verifyHmacSha256Hex(
  secret: string,
  payload: string,
  expectedHex: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex === expectedHex;
}
