import { createHash } from "node:crypto";
import type { familyPlanners, plannerDays, plannerRewards, plannerRewardTemplates } from "../drizzle/schema";

export const BACKUP_FORMAT = "my-elf-countdown-family-backup";
export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_CHUNK_CHARS = 256_000;

type Planner = Pick<typeof familyPlanners.$inferSelect, "childDisplayName" | "countdownLength" | "startDate">;
type Day = Pick<typeof plannerDays.$inferSelect, "dayNumber" | "elfNote" | "activity" | "habitPrompt" | "completed" | "completedAt">;
type Reward = Pick<typeof plannerRewards.$inferSelect, "dayNumber" | "label" | "imageData" | "imageMime" | "templateId">;
type Template = Pick<typeof plannerRewardTemplates.$inferSelect, "id" | "label" | "imageData" | "imageMime">;

export class FamilyBackupError extends Error {
  constructor(public readonly reason: "missing" | "changed" | "part") {
    super(reason === "missing" ? "There is no active family planner to back up."
      : reason === "changed" ? "Your planner changed during the download. Please download a fresh backup."
      : "The requested backup part is invalid. Please start the download again.");
  }
}

/** Explicit content allowlist; extra row fields can never leak into the backup. */
export function buildFamilyBackupContent(input: {
  planner: Planner;
  days: Day[];
  rewards: Reward[];
  templates: Template[];
}) {
  const templates = [...input.templates].sort((a, b) => a.id - b.id);
  const references = new Map(templates.map((template, index) => [template.id, `template-${index + 1}`]));
  return {
    planner: {
      childDisplayName: input.planner.childDisplayName,
      countdownLength: input.planner.countdownLength,
      startDate: input.planner.startDate,
    },
    days: [...input.days].sort((a, b) => a.dayNumber - b.dayNumber).map(day => ({
      dayNumber: day.dayNumber,
      elfNote: day.elfNote,
      activity: day.activity,
      habitPrompt: day.habitPrompt,
      completed: day.completed,
      completedAt: day.completedAt?.toISOString() ?? null,
    })),
    rewards: [...input.rewards].sort((a, b) => a.dayNumber - b.dayNumber).map(reward => ({
      dayNumber: reward.dayNumber,
      label: reward.label,
      imageData: reward.imageData,
      imageMime: reward.imageMime,
      sourceTemplateRef: reward.templateId === null ? null : references.get(reward.templateId) ?? null,
    })),
    templates: templates.map(template => ({
      ref: references.get(template.id)!,
      label: template.label,
      imageData: template.imageData,
      imageMime: template.imageMime,
    })),
  };
}

export type FamilyBackupContent = ReturnType<typeof buildFamilyBackupContent>;

export function createFamilyBackupPart(content: FamilyBackupContent, part: number, expectedHash?: string) {
  const serialized = JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, content });
  const sha256 = createHash("sha256").update(serialized, "utf8").digest("hex");
  const totalParts = Math.ceil(serialized.length / BACKUP_CHUNK_CHARS);
  if (!Number.isInteger(part) || part < 0 || part >= totalParts || (part > 0 && !expectedHash)) {
    throw new FamilyBackupError("part");
  }
  if (expectedHash && expectedHash !== sha256) throw new FamilyBackupError("changed");
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    part,
    totalParts,
    sha256,
    chunk: serialized.slice(part * BACKUP_CHUNK_CHARS, (part + 1) * BACKUP_CHUNK_CHARS),
  };
}
