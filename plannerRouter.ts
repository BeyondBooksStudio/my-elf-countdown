import { TRPCError } from "@trpc/server";
import { SignJWT, jwtVerify } from "jose";
import { parse as parseCookieHeader } from "cookie";
import { z } from "zod";
import { ENV } from "./_core/env";
import { protectedProcedure, router } from "./_core/trpc";
import * as plannerDb from "./plannerDb";
import { clearParentUnlockCookie, hashParentPin, PARENT_PIN_PATTERN, validateRewardImageData, verifyParentPin } from "./plannerSecurity";
import { assertActiveCountdownDay, assertPlannerNotDeleted, PlannerGuardError } from "./plannerGuard";
import { createFamilyBackupPart, FamilyBackupError } from "./familyBackup";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, "Choose a valid calendar date.");

const dayNumber = z.number().int().min(1).max(24);
const parentPin = z.string().regex(PARENT_PIN_PATTERN, "Use exactly six digits for the grown-up PIN.");
const parentUnlockCookie = "elfplanner_parent_unlock";
const unlockCookieMaxAge = 60 * 60 * 1000;
const unlockWindowMs = 15 * 60 * 1000;
const maxFailedUnlocks = 8;
const failedUnlocks = new Map<string, { count: number; expiresAt: number }>();

// Identifies unlock cookies made by this app (so they cannot be mixed up with anything else).
const UNLOCK_APP_ID = "elf-countdown";

function signingKey() {
  if (ENV.unlockSecret.length < 32) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Parent unlock is not configured." });
  return new TextEncoder().encode(ENV.unlockSecret);
}

async function makeParentUnlockToken(userId: string) {
  return new SignJWT({ purpose: "elfplanner-parent-unlock", appId: UNLOCK_APP_ID })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(signingKey());
}

async function hasValidParentUnlock(ctx: { req: { headers: { cookie?: string } }; user: { id: string } }) {
  const token = parseCookieHeader(ctx.req.headers.cookie ?? "")[parentUnlockCookie];
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ["HS256"] });
    return payload.purpose === "elfplanner-parent-unlock"
      && payload.appId === UNLOCK_APP_ID
      && payload.sub === ctx.user.id;
  } catch {
    return false;
  }
}

function issueParentUnlockCookie(res: { cookie: (name: string, value: string, options: object) => unknown }, token: string) {
  res.cookie(parentUnlockCookie, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: unlockCookieMaxAge,
  });
}

const parentProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!(await hasValidParentUnlock(ctx))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Unlock parent mode with your six-digit PIN to continue." });
  }
  return next({ ctx });
});

function assertUnlockAllowed(userId: string) {
  const now = Date.now();
  const state = failedUnlocks.get(userId);
  if (state && state.expiresAt > now && state.count >= maxFailedUnlocks) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many incorrect PIN attempts. Please wait 15 minutes and try again." });
  }
  if (!state || state.expiresAt <= now) failedUnlocks.set(userId, { count: 0, expiresAt: now + unlockWindowMs });
}

function recordFailedUnlock(userId: string) {
  const now = Date.now();
  const state = failedUnlocks.get(userId);
  if (!state || state.expiresAt <= now) failedUnlocks.set(userId, { count: 1, expiresAt: now + unlockWindowMs });
  else state.count += 1;
}

async function requireActiveDay(userId: string, day: number) {
  const planner = await plannerDb.getOrCreateFamilyPlanner(userId);
  assertActiveCountdownDay(planner.isDeleted, planner.countdownLength, day);
}

async function requireActivePlanner(userId: string) {
  const planner = await plannerDb.getOrCreateFamilyPlanner(userId);
  assertPlannerNotDeleted(planner.isDeleted);
}

function handlePlannerError(error: unknown): never {
  if (error instanceof PlannerGuardError) {
    throw new TRPCError({
      code: error.reason === "deleted" ? "PRECONDITION_FAILED" : error.reason === "target-changed" ? "CONFLICT" : "BAD_REQUEST",
      message: error.message,
    });
  }
  if (error instanceof TRPCError) throw error;
  console.error("[Planner] Request failed:", error instanceof Error ? error.message : "unknown error");
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The planner could not be saved. Please try again." });
}

export const plannerRouter = router({
  pinStatus: protectedProcedure.query(async ({ ctx }) => {
    try { return await plannerDb.getPlannerPinStatus(ctx.user.id); }
    catch (error) { return handlePlannerError(error); }
  }),

  setupPin: protectedProcedure.input(z.object({ pin: parentPin })).mutation(async ({ ctx, input }) => {
    try {
      const saved = await plannerDb.setInitialPlannerPinHash(ctx.user.id, hashParentPin(input.pin));
      if (!saved) throw new TRPCError({ code: "CONFLICT", message: "A grown-up PIN is already set. Enter it to unlock parent mode." });
      issueParentUnlockCookie(ctx.res, await makeParentUnlockToken(ctx.user.id));
      return { success: true };
    } catch (error) { return handlePlannerError(error); }
  }),

  unlockParent: protectedProcedure.input(z.object({ pin: parentPin })).mutation(async ({ ctx, input }) => {
    try {
      assertUnlockAllowed(ctx.user.id);
      const storedHash = await plannerDb.getPlannerPinHash(ctx.user.id);
      if (!storedHash) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Set a grown-up PIN before opening parent mode." });
      if (!verifyParentPin(input.pin, storedHash)) {
        recordFailedUnlock(ctx.user.id);
        throw new TRPCError({ code: "FORBIDDEN", message: "That PIN did not match. Try again." });
      }
      failedUnlocks.delete(ctx.user.id);
      issueParentUnlockCookie(ctx.res, await makeParentUnlockToken(ctx.user.id));
      return { success: true };
    } catch (error) { return handlePlannerError(error); }
  }),

  changePin: parentProcedure.input(z.object({ pin: parentPin })).mutation(async ({ ctx, input }) => {
    try { return await plannerDb.changePlannerPinHash(ctx.user.id, hashParentPin(input.pin)); }
    catch (error) { return handlePlannerError(error); }
  }),

  lockParent: protectedProcedure.mutation(({ ctx }) => {
    clearParentUnlockCookie(ctx.res);
    return { success: true };
  }),

  overview: parentProcedure.query(async ({ ctx }) => {
    try { return await plannerDb.getPlannerOverview(ctx.user.id); }
    catch (error) { return handlePlannerError(error); }
  }),

  listRewardTemplates: parentProcedure.query(async ({ ctx }) => {
    try { return await plannerDb.getPlannerRewardTemplates(ctx.user.id); }
    catch (error) { return handlePlannerError(error); }
  }),

  downloadFamilyBackup: parentProcedure.input(z.object({
    part: z.number().int().min(0).default(0),
    expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).strict()).mutation(async ({ ctx, input }) => {
    try {
      const content = await plannerDb.getFamilyBackupContent(ctx.user.id);
      return createFamilyBackupPart(content, input.part, input.expectedHash);
    } catch (error) {
      if (error instanceof FamilyBackupError) {
        throw new TRPCError({ code: error.reason === "changed" ? "CONFLICT" : error.reason === "missing" ? "NOT_FOUND" : "BAD_REQUEST", message: error.message });
      }
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Your backup could not be downloaded. Please try again." });
    }
  }),

  childView: protectedProcedure.query(async ({ ctx }) => {
    try { return await plannerDb.getChildPlannerView(ctx.user.id); }
    catch (error) { return handlePlannerError(error); }
  }),

  createFresh: parentProcedure.mutation(async ({ ctx }) => {
    try { return await plannerDb.createFreshFamilyPlanner(ctx.user.id); }
    catch (error) { return handlePlannerError(error); }
  }),

  updateSettings: parentProcedure.input(z.object({
    childDisplayName: z.string().trim().min(1).max(80),
    countdownLength: z.union([z.literal(12), z.literal(24)]),
    startDate: isoDate,
  })).mutation(async ({ ctx, input }) => {
    try {
      await requireActivePlanner(ctx.user.id);
      return await plannerDb.updatePlannerSettings(ctx.user.id, input);
    }
    catch (error) { return handlePlannerError(error); }
  }),

  updateDay: parentProcedure.input(z.object({
    dayNumber,
    elfNote: z.string().trim().min(1).max(500),
    activity: z.string().trim().min(1).max(500),
    habitPrompt: z.string().trim().max(240).nullable(),
  })).mutation(async ({ ctx, input }) => {
    try {
      await requireActiveDay(ctx.user.id, input.dayNumber);
      return await plannerDb.updatePlannerDay(ctx.user.id, input);
    } catch (error) { return handlePlannerError(error); }
  }),

  setCompleted: parentProcedure.input(z.object({ dayNumber, completed: z.boolean(), expectedHabitPrompt: z.string().max(240).nullable() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await requireActiveDay(ctx.user.id, input.dayNumber);
        return await plannerDb.setPlannerDayCompleted(ctx.user.id, input.dayNumber, input.completed, input.expectedHabitPrompt);
      } catch (error) { return handlePlannerError(error); }
    }),

  saveReward: parentProcedure.input(z.object({
    dayNumber,
    label: z.string().trim().min(1).max(180),
    imageData: z.string().max(700_000).nullable(),
    templateId: z.number().int().positive().nullable().default(null),
    saveAsTemplate: z.boolean().default(false),
  })).mutation(async ({ ctx, input }) => {
    try {
      await requireActiveDay(ctx.user.id, input.dayNumber);
      let image: ReturnType<typeof validateRewardImageData>;
      try { image = validateRewardImageData(input.imageData); }
      catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Use a JPEG, PNG, or WebP image." }); }
      if (input.saveAsTemplate && (!image.imageData || !image.imageMime)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Add a matching elf picture before saving a reusable template." });
      }
      return await plannerDb.upsertPlannerReward(ctx.user.id, {
        dayNumber: input.dayNumber,
        label: input.label,
        ...image,
        templateId: input.templateId,
        saveAsTemplate: input.saveAsTemplate,
      });
    } catch (error) { return handlePlannerError(error); }
  }),

  updateRewardTemplate: parentProcedure.input(z.object({
    templateId: z.number().int().positive(),
    label: z.string().trim().min(1).max(180),
    imageData: z.string().max(700_000),
  })).mutation(async ({ ctx, input }) => {
    try {
      await requireActivePlanner(ctx.user.id);
      let image: ReturnType<typeof validateRewardImageData>;
      try { image = validateRewardImageData(input.imageData); }
      catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Use a JPEG, PNG, or WebP image." }); }
      if (!image.imageData || !image.imageMime) throw new TRPCError({ code: "BAD_REQUEST", message: "A matching elf picture is required for a reusable template." });
      const updated = await plannerDb.updatePlannerRewardTemplate(ctx.user.id, input.templateId, input.label, image.imageData, image.imageMime);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "That saved reward template could not be found." });
      return { success: true };
    } catch (error) { return handlePlannerError(error); }
  }),

  deleteRewardTemplate: parentProcedure.input(z.object({ templateId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await requireActivePlanner(ctx.user.id);
        const deleted = await plannerDb.deletePlannerRewardTemplate(ctx.user.id, input.templateId);
        if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "That saved reward template could not be found." });
        return { success: true };
      } catch (error) { return handlePlannerError(error); }
    }),

  removeRewardImage: parentProcedure.input(z.object({ dayNumber }))
    .mutation(async ({ ctx, input }) => {
      try { await requireActiveDay(ctx.user.id, input.dayNumber); return await plannerDb.clearPlannerRewardImage(ctx.user.id, input.dayNumber); }
      catch (error) { return handlePlannerError(error); }
    }),

  deleteReward: parentProcedure.input(z.object({ dayNumber }))
    .mutation(async ({ ctx, input }) => {
      try { await requireActiveDay(ctx.user.id, input.dayNumber); return await plannerDb.deletePlannerReward(ctx.user.id, input.dayNumber); }
      catch (error) { return handlePlannerError(error); }
    }),

  deleteFamily: parentProcedure.mutation(async ({ ctx }) => {
    try { return await plannerDb.deleteFamilyPlanner(ctx.user.id); }
    catch (error) { return handlePlannerError(error); }
  }),
});
