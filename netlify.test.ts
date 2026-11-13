import type { Handler, HandlerContext, HandlerEvent, HandlerResponse } from "@netlify/functions";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT, type JWK, type CryptoKey } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashParentPin, PARENT_UNLOCK_COOKIE_NAME } from "./plannerSecurity";
import { BACKUP_FORMAT, buildFamilyBackupContent, FamilyBackupError } from "./familyBackup";

// The real database module is replaced before the real app/handler is imported,
// so these tests can never touch a real database. Supabase is simulated by a
// local signing key and a fake network: no real Supabase call is ever made.
const boundaries = vi.hoisted(() => {
  const blocked = (name: string) => vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error(`Unexpected isolated-test boundary: ${name}`);
  });
  return {
    db: { getDb: blocked("real database access") },
    planner: {
      getOrCreateFamilyPlanner: blocked("getOrCreateFamilyPlanner"),
      getPlannerPinStatus: blocked("getPlannerPinStatus"),
      getPlannerPinHash: blocked("getPlannerPinHash"),
      setInitialPlannerPinHash: blocked("setInitialPlannerPinHash"),
      changePlannerPinHash: blocked("changePlannerPinHash"),
      getPlannerOverview: blocked("getPlannerOverview"),
      getPlannerRewardTemplates: blocked("getPlannerRewardTemplates"),
      getFamilyBackupContent: blocked("getFamilyBackupContent"),
      getChildPlannerView: blocked("getChildPlannerView"),
      updatePlannerSettings: blocked("updatePlannerSettings"),
      updatePlannerDay: blocked("updatePlannerDay"),
      setPlannerDayCompleted: blocked("setPlannerDayCompleted"),
      upsertPlannerReward: blocked("upsertPlannerReward"),
      updatePlannerRewardTemplate: blocked("updatePlannerRewardTemplate"),
      deletePlannerRewardTemplate: blocked("deletePlannerRewardTemplate"),
      clearPlannerRewardImage: blocked("clearPlannerRewardImage"),
      deletePlannerReward: blocked("deletePlannerReward"),
      deleteFamilyPlanner: blocked("deleteFamilyPlanner"),
      createFreshFamilyPlanner: blocked("createFreshFamilyPlanner"),
    },
    fetch: vi.fn(),
  };
});

vi.mock("./db", () => boundaries.db);
vi.mock("./plannerDb", () => boundaries.planner);

const supabaseUrl = "https://synthetic-project.supabase.example.invalid";
const issuer = `${supabaseUrl}/auth/v1`;
const jwksUrl = `${issuer}/.well-known/jwks.json`;
const serverUserUrl = `${issuer}/user`;
const publishableKey = "sb_publishable_synthetic_not_a_real_key";
const unlockSecret = "synthetic-unlock-secret-that-is-at-least-32-chars-never-deployed";
const unlockAppId = "elf-countdown";
const parentPin = "123456";
const parentPinHash = hashParentPin(parentPin);
const syntheticUser = {
  id: "7007a1b2-1111-4222-8333-444455556666",
  email: "synthetic-parent@example.invalid",
};
const otherUserId = "8008a1b2-1111-4222-8333-444455556666";
const privateMarkers = {
  parent: "SYNTHETIC_PRIVATE_PARENT_OVERVIEW",
  templates: "SYNTHETIC_PRIVATE_TEMPLATE_LIBRARY",
  child: "SYNTHETIC_PRIVATE_CHILD_VIEW",
  backup: "SYNTHETIC_PRIVATE_BACKUP_CONTENT",
};

let handler: Handler;
let signingKey: CryptoKey;
let attackerKey: CryptoKey;
let publicJwk: JWK;
const legacyToken = "synthetic.legacy-hs256.token";
const unexpectedFetches: string[] = [];
let serverUserLookups = 0;

function installSyntheticEnvironment() {
  vi.stubEnv("SUPABASE_URL", supabaseUrl);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", publishableKey);
  vi.stubEnv("PARENT_UNLOCK_SECRET", unlockSecret);
  vi.stubEnv("DATABASE_URL", "");
  vi.stubGlobal("fetch", boundaries.fetch);
}

/** A tiny pretend Supabase: it publishes one public key and recognises one old-style token. */
function installFakeSupabase() {
  boundaries.fetch.mockImplementation(async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url === jwksUrl) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === serverUserUrl) {
      serverUserLookups += 1;
      const headers = init?.headers ?? {};
      if (headers.apikey === publishableKey && headers.Authorization === `Bearer ${legacyToken}`) {
        return new Response(JSON.stringify({ id: syntheticUser.id, email: syntheticUser.email, user_metadata: { display_name: "Synthetic Parent" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ message: "invalid JWT" }), { status: 401 });
    }
    unexpectedFetches.push(url);
    throw new Error(`Outbound fetch is forbidden: ${url}`);
  });
}

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "synthetic-key-1", alg: "ES256", use: "sig" };
  attackerKey = (await generateKeyPair("ES256")).privateKey;
  installSyntheticEnvironment();
  ({ handler } = await import("../netlify/functions/api"));
});

beforeEach(() => {
  vi.resetAllMocks();
  unexpectedFetches.length = 0;
  serverUserLookups = 0;
  installSyntheticEnvironment();
  installFakeSupabase();
  for (const [name, mock] of Object.entries(boundaries.planner)) {
    mock.mockImplementation(async () => { throw new Error(`Unexpected planner access: ${name}`); });
  }
  boundaries.db.getDb.mockImplementation(async () => { throw new Error("Real database access is forbidden"); });
  boundaries.planner.getPlannerPinHash.mockResolvedValue(parentPinHash);
  boundaries.planner.getPlannerOverview.mockResolvedValue({ marker: privateMarkers.parent });
  boundaries.planner.getPlannerRewardTemplates.mockResolvedValue([{ marker: privateMarkers.templates }]);
  boundaries.planner.getChildPlannerView.mockResolvedValue({ marker: privateMarkers.child });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  // Applies to every case, including rejection paths that could otherwise hide an attempted outside call.
  try {
    expect(boundaries.db.getDb).not.toHaveBeenCalled();
    expect(unexpectedFetches).toEqual([]);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});
afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const apiPrefixes = ["/api", "/.netlify/functions/api"] as const;

function eventFor(path: string, overrides: Partial<HandlerEvent> = {}): HandlerEvent {
  const query = overrides.queryStringParameters ?? {};
  const rawQuery = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  ).toString();
  return {
    rawUrl: `https://synthetic-site.example.invalid${path}${rawQuery ? `?${rawQuery}` : ""}`,
    rawQuery,
    path,
    httpMethod: "GET",
    headers: { host: "synthetic-site.example.invalid", "x-forwarded-proto": "https" },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
    ...overrides,
  };
}

function contextFor(): HandlerContext {
  return {
    callbackWaitsForEmptyEventLoop: true,
    functionName: "synthetic-api",
    functionVersion: "$LATEST",
    invokedFunctionArn: "synthetic-function-arn",
    memoryLimitInMB: "1024",
    awsRequestId: "synthetic-request-id",
    logGroupName: "synthetic-log-group",
    logStreamName: "synthetic-log-stream",
    getRemainingTimeInMillis: () => 10_000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };
}

async function invoke(path: string, overrides: Partial<HandlerEvent> = {}) {
  const context = contextFor();
  const response = await handler(eventFor(path, overrides), context);
  expect(response).toBeDefined();
  expect(context.callbackWaitsForEmptyEventLoop).toBe(false);
  return response as HandlerResponse;
}

function responseText(response: HandlerResponse) {
  return response.isBase64Encoded
    ? Buffer.from(response.body ?? "", "base64").toString("utf8")
    : response.body ?? "";
}

function responseJson(response: HandlerResponse) {
  return JSON.parse(responseText(response));
}

function header(response: HandlerResponse, name: string) {
  const entry = Object.entries(response.headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry ? String(entry[1]) : undefined;
}

function cookieValues(response: HandlerResponse): string[] {
  // Do not split on commas: Expires contains a comma. Preserve each Set-Cookie
  // value returned by serverless-http in Netlify's multiValueHeaders contract.
  const values = Object.entries(response.multiValueHeaders ?? {})
    .find(([key]) => key.toLowerCase() === "set-cookie")?.[1];
  if (values) return values.map(String);
  const single = header(response, "set-cookie");
  return single ? [single] : [];
}

function expectNoPlannerAccess() {
  for (const mock of Object.values(boundaries.planner)) expect(mock).not.toHaveBeenCalled();
}

function expectDenied(response: HandlerResponse, status: number, code: string) {
  expect(response.statusCode).toBe(status);
  const payload = responseJson(response);
  expect(payload.error.json.data.code).toBe(code);
  expect(payload).not.toHaveProperty("result");
  for (const marker of Object.values(privateMarkers)) expect(responseText(response)).not.toContain(marker);
  expectNoPlannerAccess();
}

type TokenOptions = { key?: CryptoKey; kid?: string; subject?: string; issuer?: string; audience?: string; role?: string; expires?: string; extra?: Record<string, unknown> };

/** Makes a login token shaped like the ones Supabase issues. */
async function accessToken(options: TokenOptions = {}) {
  return new SignJWT({ role: options.role ?? "authenticated", email: syntheticUser.email, ...(options.extra ?? {}) })
    .setProtectedHeader({ alg: "ES256", kid: options.kid ?? "synthetic-key-1", typ: "JWT" })
    .setSubject(options.subject ?? syntheticUser.id)
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(options.expires ?? "1h")
    .sign(options.key ?? signingKey);
}

async function signedIn() {
  return { authorization: `Bearer ${await accessToken()}` };
}

async function unlockToken(subject = syntheticUser.id, appId = unlockAppId, secret = unlockSecret) {
  return new SignJWT({ purpose: "elfplanner-parent-unlock", appId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(subject).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
}

describe("real Netlify API handler: routing and runtime configuration", () => {
  it.each(apiPrefixes)("serves health on %s/health without authentication or database access", async prefix => {
    const response = await invoke(`${prefix}/health`);
    expect(response.statusCode).toBe(200);
    expect(responseJson(response)).toEqual({ status: "ok" });
    expect(header(response, "content-type")).toContain("application/json");
    expect(header(response, "cache-control")).toBe("private, no-store");
    expect(boundaries.fetch).not.toHaveBeenCalled();
    expectNoPlannerAccess();
  });

  it.each(apiPrefixes)("exposes only the two public Supabase settings via %s", async prefix => {
    const secretValues = {
      DATABASE_URL: "synthetic-secret-database-url",
      PARENT_UNLOCK_SECRET: "synthetic-secret-unlock-key-0123456789abcdef",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-secret-service-role",
      UNRELATED_SECRET: "synthetic-unrelated-secret",
    };
    for (const [key, value] of Object.entries(secretValues)) vi.stubEnv(key, value);
    vi.stubEnv("SUPABASE_URL", "https://dynamic-project.supabase.example.invalid/");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_dynamic</script>");
    const response = await invoke(`${prefix}/platform/config.js`);
    expect(response.statusCode).toBe(200);
    expect(header(response, "content-type")).toContain("application/javascript");
    expect(header(response, "cache-control")).toBe("private, no-store");
    const script = responseText(response);
    expect(script).toMatch(/^window\.__APP_CONFIG__=/);
    const config = JSON.parse(script.slice("window.__APP_CONFIG__=".length, -1));
    expect(config).toEqual({
      supabaseUrl: "https://dynamic-project.supabase.example.invalid",
      supabasePublishableKey: "sb_publishable_dynamic</script>",
    });
    expect(script).not.toContain("</script>");
    for (const [name, value] of Object.entries(secretValues)) {
      expect(script).not.toContain(name);
      expect(script).not.toContain(value);
    }
    // A second request through the same imported handler sees fresh runtime env.
    vi.stubEnv("SUPABASE_URL", "https://second-project.supabase.example.invalid");
    expect(responseText(await invoke(`${prefix}/platform/config.js`))).toContain("second-project");
    expectNoPlannerAccess();
  });

  it.each(apiPrefixes)("returns JSON 404, not the SPA, for missing paths under %s", async prefix => {
    for (const suffix of ["", "/", "/does-not-exist", "/platform/missing.js"]) {
      const response = await invoke(`${prefix}${suffix}`);
      expect(response.statusCode).toBe(404);
      expect(responseJson(response)).toEqual({ error: "API route not found" });
      expect(header(response, "content-type")).toContain("application/json");
      expect(responseText(response)).not.toMatch(/<!doctype|<html|<div id="root"/i);
    }
    const unknownProcedure = await invoke(`${prefix}/trpc/planner.doesNotExist`);
    expect(unknownProcedure.statusCode).toBe(404);
    expect(responseJson(unknownProcedure).error.json.data.code).toBe("NOT_FOUND");
    expect(responseText(unknownProcedure)).not.toMatch(/<!doctype|<html/i);
    expectNoPlannerAccess();
  });

  it.each(apiPrefixes)("no longer has any Manus sign-in route on %s", async prefix => {
    const response = await invoke(`${prefix}/oauth/callback`, { queryStringParameters: { code: "x", state: "y" } });
    expect(response.statusCode).toBe(404);
    expect(responseJson(response)).toEqual({ error: "API route not found" });
    expect(cookieValues(response)).toEqual([]);
  });
});

describe("real Supabase authentication and parent-PIN boundaries", () => {
  const protectedReads = ["planner.overview", "planner.listRewardTemplates", "planner.childView"] as const;

  it.each(protectedReads)("rejects unauthenticated %s on original and direct paths", async procedure => {
    for (const prefix of apiPrefixes) {
      expectDenied(await invoke(`${prefix}/trpc/${procedure}`), 401, "UNAUTHORIZED");
    }
  });

  it.each(protectedReads)("rejects forged, expired, foreign or wrongly-shaped tokens for %s", async procedure => {
    const attempts: Record<string, string>[] = [
      { authorization: `Bearer ${await accessToken({ key: attackerKey })}` },
      { authorization: `Bearer ${await accessToken({ key: attackerKey, kid: "attacker-key" })}` },
      { authorization: `Bearer ${await accessToken({ expires: "-1h" })}` },
      { authorization: `Bearer ${await accessToken({ audience: "some-other-audience" })}` },
      { authorization: `Bearer ${await accessToken({ issuer: "https://attacker.example.invalid/auth/v1" })}` },
      { authorization: `Bearer ${await accessToken({ role: "anon" })}` },
      { authorization: `Bearer ${await accessToken({ extra: { is_anonymous: true } })}` },
      { authorization: `Bearer ${await accessToken({ subject: "not-a-uuid" })}` },
      { authorization: "Bearer not-even-a-token" },
      { authorization: "Basic abc123" },
      // A token placed in a cookie must never count as a login.
      { cookie: `sb-access-token=${await accessToken()}` },
      // The parent-unlock cookie alone is not a login either.
      { cookie: `${PARENT_UNLOCK_COOKIE_NAME}=${await unlockToken()}` },
    ];
    for (const headers of attempts) {
      for (const prefix of apiPrefixes) {
        expectDenied(await invoke(`${prefix}/trpc/${procedure}`, { headers }), 401, "UNAUTHORIZED");
      }
    }
  });

  it("accepts an older-style Supabase token only when Supabase itself vouches for it", async () => {
    const accepted = await invoke("/api/trpc/planner.childView", { headers: { authorization: `Bearer ${legacyToken}` } });
    expect(accepted.statusCode).toBe(200);
    expect(boundaries.planner.getChildPlannerView).toHaveBeenCalledWith(syntheticUser.id);
    expect(serverUserLookups).toBe(1);
    Object.values(boundaries.planner).forEach(mock => mock.mockClear());
    expectDenied(await invoke("/api/trpc/planner.overview", { headers: { authorization: "Bearer synthetic.unknown.token" } }), 401, "UNAUTHORIZED");
  });

  it("does not use the older-style check when the publishable key is missing", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    expectDenied(await invoke("/api/trpc/planner.childView", { headers: { authorization: `Bearer ${legacyToken}` } }), 401, "UNAUTHORIZED");
    expect(serverUserLookups).toBe(0);
  });

  it("refuses everything when the Supabase URL is not configured", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    expectDenied(await invoke("/api/trpc/planner.childView", { headers: await signedIn() }), 401, "UNAUTHORIZED");
  });

  it.each(["planner.overview", "planner.listRewardTemplates"])("requires a valid PIN-unlock cookie, not just a login, for %s", async procedure => {
    const login = await signedIn();
    const unlockAttempts = [
      "",
      `${PARENT_UNLOCK_COOKIE_NAME}=forged-unlock-cookie`,
      `${PARENT_UNLOCK_COOKIE_NAME}=${await unlockToken(otherUserId)}`,
      `${PARENT_UNLOCK_COOKIE_NAME}=${await unlockToken(syntheticUser.id, "some-other-app")}`,
      `${PARENT_UNLOCK_COOKIE_NAME}=${await unlockToken(syntheticUser.id, unlockAppId, "synthetic-attacker-key-that-is-long-enough-123456")}`,
    ];
    for (const unlockCookie of unlockAttempts) {
      for (const prefix of apiPrefixes) {
        const headers = { ...login, ...(unlockCookie ? { cookie: unlockCookie } : {}) };
        expectDenied(await invoke(`${prefix}/trpc/${procedure}`, { headers }), 403, "FORBIDDEN");
      }
    }
  });

  it("reports parent unlock as not configured when the unlock secret is too short", async () => {
    vi.stubEnv("PARENT_UNLOCK_SECRET", "too-short");
    const response = await invoke("/api/trpc/planner.unlockParent", {
      httpMethod: "POST", headers: { ...(await signedIn()), "content-type": "application/json" },
      body: JSON.stringify({ json: { pin: parentPin } }),
    });
    expect(response.statusCode).toBe(500);
    expect(cookieValues(response)).toEqual([]);
  });

  it.each(apiPrefixes)("allows the signed-in child's view without a parent PIN on %s", async prefix => {
    const response = await invoke(`${prefix}/trpc/planner.childView`, { headers: await signedIn() });
    expect(response.statusCode).toBe(200);
    expect(responseJson(response).result.data.json).toEqual({ marker: privateMarkers.child });
    expect(boundaries.planner.getChildPlannerView).toHaveBeenCalledTimes(1);
    expect(boundaries.planner.getChildPlannerView).toHaveBeenCalledWith(syntheticUser.id);
    expect(boundaries.planner.getPlannerOverview).not.toHaveBeenCalled();
    expect(boundaries.planner.getPlannerRewardTemplates).not.toHaveBeenCalled();
    expect(boundaries.planner.getPlannerPinHash).not.toHaveBeenCalled();
  });

  it("scopes every planner call to the user in the token, never to a user supplied in the request", async () => {
    const response = await invoke("/api/trpc/planner.childView", {
      headers: await signedIn(),
      queryStringParameters: { input: JSON.stringify({ json: { userId: otherUserId } }) },
    });
    expect(response.statusCode).toBe(200);
    expect(boundaries.planner.getChildPlannerView).toHaveBeenCalledWith(syntheticUser.id);
    expect(boundaries.planner.getChildPlannerView).not.toHaveBeenCalledWith(otherUserId);
  });
});

describe("Netlify family backup parent-only boundary", () => {
  function backupRequest(headers: Record<string, string>, input: Record<string, unknown> = {}): Partial<HandlerEvent> {
    return { httpMethod: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ json: input }) };
  }

  it.each(apiPrefixes)("rejects unauthenticated and signed-in-without-PIN backup requests on %s", async prefix => {
    const unauthenticated = await invoke(`${prefix}/trpc/planner.downloadFamilyBackup`, backupRequest({}));
    expectDenied(unauthenticated, 401, "UNAUTHORIZED");
    expect(header(unauthenticated, "cache-control")).toBe("private, no-store");
    const locked = await invoke(`${prefix}/trpc/planner.downloadFamilyBackup`, backupRequest(await signedIn()));
    expectDenied(locked, 403, "FORBIDDEN");
    expect(header(locked, "cache-control")).toBe("private, no-store");
  });

  it.each(apiPrefixes)("downloads synthetic content only after valid PIN unlock and passes the signed-in user ID on %s", async prefix => {
    const content = buildFamilyBackupContent({
      planner: { childDisplayName: privateMarkers.backup, countdownLength: 12, startDate: "2026-12-01" },
      days: [], rewards: [], templates: [],
    });
    boundaries.planner.getFamilyBackupContent.mockResolvedValue(content);
    const login = await signedIn();
    const unlock = await invoke(`${prefix}/trpc/planner.unlockParent`, {
      httpMethod: "POST", headers: { ...login, "content-type": "application/json" },
      body: JSON.stringify({ json: { pin: parentPin } }),
    });
    expect(unlock.statusCode).toBe(200);
    const unlockCookie = cookieValues(unlock).find(value => value.startsWith(`${PARENT_UNLOCK_COOKIE_NAME}=`));
    expect(unlockCookie).toBeDefined();
    const response = await invoke(`${prefix}/trpc/planner.downloadFamilyBackup`, backupRequest({ ...login, cookie: unlockCookie!.split(";")[0] }));
    expect(response.statusCode).toBe(200);
    expect(header(response, "cache-control")).toBe("private, no-store");
    const part = responseJson(response).result.data.json;
    expect(part).toMatchObject({ format: BACKUP_FORMAT, schemaVersion: 1, part: 0, totalParts: 1 });
    expect(part.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(part.chunk).content).toEqual(content);
    expect(boundaries.planner.getFamilyBackupContent).toHaveBeenCalledTimes(1);
    expect(boundaries.planner.getFamilyBackupContent).toHaveBeenCalledWith(syntheticUser.id);
    expect(boundaries.planner.getPlannerPinHash).toHaveBeenCalledTimes(1);
    expect(boundaries.planner.getPlannerPinHash).toHaveBeenCalledWith(syntheticUser.id);
    for (const [name, mock] of Object.entries(boundaries.planner)) {
      if (!["getFamilyBackupContent", "getPlannerPinHash"].includes(name)) expect(mock).not.toHaveBeenCalled();
    }
  });

  it("rejects an arbitrary planner ID instead of treating it as the backup owner", async () => {
    const headers = { ...(await signedIn()), cookie: `${PARENT_UNLOCK_COOKIE_NAME}=${await unlockToken()}` };
    const response = await invoke("/.netlify/functions/api/trpc/planner.downloadFamilyBackup", backupRequest(headers, { part: 0, plannerId: 99999 }));
    expectDenied(response, 400, "BAD_REQUEST");
    expect(header(response, "cache-control")).toBe("private, no-store");
  });

  it("does not let one parent's unlock cookie open another parent's backup", async () => {
    const headers = { ...(await signedIn()), cookie: `${PARENT_UNLOCK_COOKIE_NAME}=${await unlockToken(otherUserId)}` };
    expectDenied(await invoke("/api/trpc/planner.downloadFamilyBackup", backupRequest(headers)), 403, "FORBIDDEN");
  });

  it.each([
    { reason: "missing" as const, status: 404, code: "NOT_FOUND" },
    { reason: "changed" as const, status: 409, code: "CONFLICT" },
    { reason: "part" as const, status: 400, code: "BAD_REQUEST" },
  ])("maps backup $reason errors without returning private content", async ({ reason, status, code }) => {
    boundaries.planner.getFamilyBackupContent.mockRejectedValue(new FamilyBackupError(reason));
    const headers = { ...(await signedIn()), cookie: `${PARENT_UNLOCK_COOKIE_NAME}=${await unlockToken()}` };
    const response = await invoke("/api/trpc/planner.downloadFamilyBackup", backupRequest(headers));
    expect(response.statusCode).toBe(status);
    expect(responseJson(response).error.json.data.code).toBe(code);
    expect(responseJson(response)).not.toHaveProperty("result");
    expect(responseText(response)).not.toContain(privateMarkers.backup);
    expect(header(response, "cache-control")).toBe("private, no-store");
    expect(boundaries.planner.getFamilyBackupContent).toHaveBeenCalledTimes(1);
    expect(boundaries.planner.getFamilyBackupContent).toHaveBeenCalledWith(syntheticUser.id);
    for (const [name, mock] of Object.entries(boundaries.planner)) {
      if (name !== "getFamilyBackupContent") expect(mock).not.toHaveBeenCalled();
    }
  });
});

describe("Netlify JSON bodies and base64 decoding", () => {
  it.each([
    { prefix: "/api", base64: false },
    { prefix: "/.netlify/functions/api", base64: false },
    { prefix: "/api", base64: true },
    { prefix: "/.netlify/functions/api", base64: true },
  ])("handles JSON PIN-unlock bodies at $prefix (base64=$base64) and verifies the issued cookie", async ({ prefix, base64 }) => {
    const login = await signedIn();
    const body = JSON.stringify({ json: { pin: parentPin } });
    const response = await invoke(`${prefix}/trpc/planner.unlockParent`, {
      httpMethod: "POST",
      headers: { ...login, "content-type": "application/json" },
      body: base64 ? Buffer.from(body).toString("base64") : body,
      isBase64Encoded: base64,
    });
    expect(response.statusCode).toBe(200);
    expect(responseJson(response).result.data.json).toEqual({ success: true });
    expect(boundaries.planner.getPlannerPinHash).toHaveBeenCalledTimes(1);
    expect(boundaries.planner.getPlannerPinHash).toHaveBeenCalledWith(syntheticUser.id);
    const unlockCookie = cookieValues(response).find(value => value.startsWith(`${PARENT_UNLOCK_COOKIE_NAME}=`));
    expect(unlockCookie).toBeDefined();
    const overview = await invoke(`${prefix}/trpc/planner.overview`, {
      headers: { ...login, cookie: unlockCookie!.split(";")[0] },
    });
    expect(overview.statusCode).toBe(200);
    expect(responseJson(overview).result.data.json).toEqual({ marker: privateMarkers.parent });
    expect(boundaries.planner.getPlannerOverview).toHaveBeenCalledTimes(1);
    expect(boundaries.planner.getPlannerOverview).toHaveBeenCalledWith(syntheticUser.id);
    expect(boundaries.planner.getPlannerRewardTemplates).not.toHaveBeenCalled();
  });

  it("refuses a wrong PIN without issuing an unlock cookie", async () => {
    const response = await invoke("/api/trpc/planner.unlockParent", {
      httpMethod: "POST", headers: { ...(await signedIn()), "content-type": "application/json" },
      body: JSON.stringify({ json: { pin: "654321" } }),
    });
    expect(response.statusCode).toBe(403);
    expect(responseJson(response).error.json.data.code).toBe("FORBIDDEN");
    expect(responseJson(response)).not.toHaveProperty("result");
    expect(cookieValues(response).filter(value => value.startsWith(`${PARENT_UNLOCK_COOKIE_NAME}=`))).toEqual([]);
    // Only the PIN check itself ran; nothing private was read.
    expect(boundaries.planner.getPlannerPinHash).toHaveBeenCalledWith(syntheticUser.id);
    expect(boundaries.planner.getPlannerOverview).not.toHaveBeenCalled();
    expect(boundaries.planner.getChildPlannerView).not.toHaveBeenCalled();
  });

  it.each([false, true])("rejects malformed JSON before any planner access (base64=%s)", async base64 => {
    const body = '{"json":';
    const response = await invoke("/.netlify/functions/api/trpc/planner.unlockParent", {
      httpMethod: "POST",
      headers: { ...(await signedIn()), "content-type": "application/json" },
      body: base64 ? Buffer.from(body).toString("base64") : body,
      isBase64Encoded: base64,
    });
    expect(response.statusCode).toBe(400);
    expectNoPlannerAccess();
  });

  it("retains input validation for a decoded base64 mutation body", async () => {
    const response = await invoke("/.netlify/functions/api/trpc/planner.unlockParent", {
      httpMethod: "POST",
      headers: { ...(await signedIn()), "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ json: { pin: "12" } })).toString("base64"),
      isBase64Encoded: true,
    });
    expectDenied(response, 400, "BAD_REQUEST");
  });
});

describe("logout Set-Cookie preservation through the real serverless adapter", () => {
  it.each(apiPrefixes)("clears the parent-unlock cookie securely via %s", async prefix => {
    const response = await invoke(`${prefix}/trpc/auth.logout`, {
      httpMethod: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: null }),
    });
    expect(response.statusCode).toBe(200);
    expect(responseJson(response).result.data.json).toEqual({ success: true });
    const cookies = cookieValues(response);
    expect(cookies).toHaveLength(1);
    const value = cookies[0];
    expect(value).toMatch(new RegExp(`^${PARENT_UNLOCK_COOKIE_NAME}=;`));
    expect(value).toMatch(/; Path=\//i);
    expect(value).toMatch(/; Secure(?:;|$)/i);
    expect(value).toMatch(/; HttpOnly(?:;|$)/i);
    expect(value).toMatch(/; SameSite=None(?:;|$)/i);
    const expiry = /; Expires=([^;]+)/i.exec(value)?.[1];
    expect(expiry).toBeDefined();
    expect(new Date(expiry!).getTime()).toBeLessThan(Date.now());
    expect(value).not.toMatch(/; Domain=/i);
    expectNoPlannerAccess();
  });
});

describe("filesystem-only Netlify packaging checks", () => {
  it("places forced API redirects before the SPA fallback and publishes the existing build directory", () => {
    const config = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
    expect(config).toMatch(/publish\s*=\s*"dist\/public"/);
    expect(config).toMatch(/functions\s*=\s*"netlify\/functions"/);
    const redirects = config.split("[[redirects]]").slice(1).map(block => ({
      from: /from\s*=\s*"([^"]+)"/.exec(block)?.[1],
      to: /to\s*=\s*"([^"]+)"/.exec(block)?.[1],
      status: /status\s*=\s*(\d+)/.exec(block)?.[1],
      force: /force\s*=\s*true/.test(block),
    }));
    expect(redirects.slice(0, 2)).toEqual([
      { from: "/api/*", to: "/.netlify/functions/api/:splat", status: "200", force: true },
      { from: "/api", to: "/.netlify/functions/api", status: "200", force: true },
    ]);
    expect(redirects[2]).toEqual({ from: "/*", to: "/index.html", status: "200", force: false });
  });

  it.each(["christmas-sleigh-bells.mp3", "santa-final-day.mp3"])("includes the existing static audio asset %s", filename => {
    const path = fileURLToPath(new URL(`../client/public/audio/${filename}`, import.meta.url));
    const stat = statSync(path);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });
});
