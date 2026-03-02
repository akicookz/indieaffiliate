/**
 * Partner OTP and session cookie helpers (no Better Auth).
 */

const OTP_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // exclude ambiguous 0,O,1,I
const OTP_LENGTH = 6;

export function generateOtp(): string {
  let code = "";
  const bytes = new Uint8Array(OTP_LENGTH);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < OTP_LENGTH; i++) {
    code += OTP_CHARS[bytes[i]! % OTP_CHARS.length];
  }
  return code;
}

export async function hashOtp(otp: string): Promise<string> {
  const data = new TextEncoder().encode(otp.toUpperCase().trim());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyOtp(input: string, storedHash: string): Promise<boolean> {
  const inputHash = await hashOtp(input);
  return inputHash === storedHash;
}

function base64urlEncode(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  const padded = pad ? b64 + "=".repeat(4 - pad) : b64;
  const binary = atob(padded);
  return new Uint8Array(binary.length).map((_, i) => binary.charCodeAt(i));
}

export interface PartnerSessionPayload {
  email: string;
  partnerIds: string[];
  exp: number;
}

const COOKIE_MAX_AGE_DAYS = 7;

export function getPartnerSessionExpiry(): number {
  return Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
}

export async function signPartnerSession(
  payload: PartnerSessionPayload,
  secret: string,
): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const payloadB64 = base64urlEncode(payloadBytes);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64),
  );
  const sigB64 = base64urlEncode(new Uint8Array(sig));
  return `${payloadB64}.${sigB64}`;
}

export async function verifyPartnerSession(
  value: string,
  secret: string,
): Promise<PartnerSessionPayload | null> {
  const dot = value.indexOf(".");
  if (dot === -1) return null;
  const payloadB64 = value.slice(0, dot);
  const sigB64 = value.slice(dot + 1);
  if (!payloadB64 || !sigB64) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expectedSig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64),
  );
  const expectedB64 = base64urlEncode(new Uint8Array(expectedSig));
  if (expectedB64 !== sigB64) return null;

  try {
    const payloadBytes = base64urlDecode(payloadB64);
    const payloadJson = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadJson) as PartnerSessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.email || !Array.isArray(payload.partnerIds)) return null;
    return payload;
  } catch {
    return null;
  }
}
