import { bigint, boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * These tables already exist in your Supabase project ("Elf Countdown").
 * This file only DESCRIBES them so the server can read and write them.
 * Column names here are camelCase in code and snake_case in the database.
 *
 * Parents are Supabase Auth users (auth.users). `userId` is that user's UUID.
 */

/** One private planner per signed-in parent. */
export const familyPlanners = pgTable(
  "elf_family_planners",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    userId: uuid("user_id").notNull(),
    childDisplayName: varchar("child_display_name").default("Little Helper").notNull(),
    countdownLength: integer("countdown_length").default(12).notNull(),
    startDate: date("start_date", { mode: "string" }).default("2026-12-01").notNull(),
    isDeleted: boolean("is_deleted").default(false).notNull(),
    parentPinHash: varchar("parent_pin_hash"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  table => [uniqueIndex("elf_family_planners_user_id_key").on(table.userId)],
);

/** Content and positive progress for a countdown day. */
export const plannerDays = pgTable(
  "elf_planner_days",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    plannerId: bigint("planner_id", { mode: "number" }).notNull().references(() => familyPlanners.id),
    dayNumber: integer("day_number").notNull(),
    elfNote: text("elf_note").default("").notNull(),
    activity: text("activity").default("").notNull(),
    habitPrompt: text("habit_prompt"),
    completed: boolean("completed").default(false).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  table => [uniqueIndex("elf_planner_days_planner_id_day_number_key").on(table.plannerId, table.dayNumber)],
);

/** Parent-owned, private reward + matching elf-image pairs reusable across days. */
export const plannerRewardTemplates = pgTable(
  "elf_planner_reward_templates",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    plannerId: bigint("planner_id", { mode: "number" }).notNull().references(() => familyPlanners.id),
    label: varchar("label").notNull(),
    imageData: text("image_data").notNull(),
    imageMime: varchar("image_mime").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  table => [index("elf_planner_reward_templates_planner_idx").on(table.plannerId)],
);

/** One optional parent-defined reward per day. */
export const plannerRewards = pgTable(
  "elf_planner_rewards",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    plannerId: bigint("planner_id", { mode: "number" }).notNull().references(() => familyPlanners.id),
    dayNumber: integer("day_number").notNull(),
    label: varchar("label").notNull(),
    imageData: text("image_data"),
    imageMime: varchar("image_mime"),
    templateId: bigint("template_id", { mode: "number" }).references(() => plannerRewardTemplates.id),
    isRevealed: boolean("is_revealed").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("elf_planner_rewards_planner_id_day_number_key").on(table.plannerId, table.dayNumber),
    index("elf_planner_rewards_planner_idx").on(table.plannerId),
  ],
);
