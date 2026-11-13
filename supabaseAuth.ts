import type { Request } from "express";
import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { ENV } from "./env";

/** The signed-in parent, as proven by a Supabase login token. `id` is Supabase's user UUID. */
export type AuthedUser = {
  id: string;
  email: string | null;
  name: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cachedJwks: { url: string; keys: ReturnType<typeof createRemoteJWKSet> } | null = null;
function getJwks(url: string) {
  if (!cachedJwks || cachedJwks.url !== url) {
    cachedJwks = { url, keys: createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000, timeoutDuration: 5_000 }) };
  }
  return cachedJwks.keys;
}

export function bearerToken(req: Pick<Request, "headers">): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function toUser(id: unknown, email: unknown, metadata: unknown): AuthedUser | null {
  if (typeof id !== "string" || !UUID.test(id)) return null;
  const displayName = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).display_name : null;
  return {
    id: id.toLowerCase(),
    email: typeof email === "string" && email ? email : null,
    name: typeof displayName === "string" && displayName.trim() ? displayName.trim().slice(0, 80) : null,
  };
}

/** Fast path: check the token's signature against Supabase's published public keys. */
async function verifyWithPublicKeys(token: string): Promise<AuthedUser | null> {
  const issuer = `${ENV.supabaseUrl}/auth/v1`;
  const { payload } = await jwtVerify(token, getJwks(`${issuer}/.well-known/jwks.json`), {
    issuer,
    audience: "authenticated",
  });
  if (payload.role !== "authenticated" || payload.is_anonymous === true) return null;
  return toUser(payload.sub, payload.email, payload.user_metadata);
}

/** Fallback for projects that still sign with the older shared secret: ask Supabase directly. */
async function verifyWithSupabaseServer(token: string): Promise<AuthedUser | null> {
  if (!ENV.supabasePublishableKey) return null;
  const response = await fetch(`${ENV.supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: ENV.supabasePublishableKey },
  });
  if (!response.ok) return null;
  const body = await response.json() as { id?: unknown; email?: unknown; user_metadata?: unknown; is_anonymous?: unknown };
  if (body.is_anonymous === true) return null;
  return toUser(body.id, body.email, body.user_metadata);
}

/** Returns the signed-in parent, or null. Never throws for bad or missing credentials. */
export async function authenticateRequest(req: Pick<Request, "headers">): Promise<AuthedUser | null> {
  const token = bearerToken(req);
  if (!token || !ENV.supabaseUrl) return null;
  try {
    return await verifyWithPublicKeys(token);
  } catch (error) {
    // An expired token or wrong audience/issuer is a clear "no". Anything else
    // (for example the key is not in the public list) is double-checked with Supabase itself.
    if (error instanceof errors.JWTExpired || error instanceof errors.JWTClaimValidationFailed) return null;
    try { return await verifyWithSupabaseServer(token); } catch { return null; }
  }
}
