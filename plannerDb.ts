import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { familyPlanners, plannerDays, plannerRewards, plannerRewardTemplates } from "../drizzle/schema";
import { getDb } from "./db";
import { assertActiveCountdownDay, assertExpectedBehaviourTarget, assertGoodBehaviourTarget, assertPlannerNotDeleted, isRewardUnlockedForChild, PlannerGuardError } from "./plannerGuard";
import { STARTER_REWARDS } from "./starterRewards";
import { buildFamilyBackupContent, FamilyBackupError } from "./familyBackup";

type PlannerTransaction = Parameters<
  Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]
>[0];

async function lockPlannerForUpdate(tx: PlannerTransaction, userId: string) {
  const [planner] = await tx.select({
    id: familyPlanners.id,
    isDeleted: familyPlanners.isDeleted,
    countdownLength: familyPlanners.countdownLength,
  }).from(familyPlanners)
    .where(eq(familyPlanners.userId, userId))
    .limit(1)
    .for("update");
  if (!planner) throw new Error("The family planner could not be found.");
  return planner;
}

async function lockActivePlannerForUpdate(tx: PlannerTransaction, userId: string, dayNumber?: number) {
  const planner = await lockPlannerForUpdate(tx, userId);
  if (dayNumber === undefined) assertPlannerNotDeleted(planner.isDeleted);
  else assertActiveCountdownDay(planner.isDeleted, planner.countdownLength, dayNumber);
  return planner;
}

const DEMO_DAYS = [
  ["I left a tiny star where kind hearts shine. Can you spot one kind thing today?", "Draw a little thank-you picture for someone at home.", "Kindness"],
  ["The cosiest magic starts when we help each other.", "Put three books back on the shelf together.", "Helping"],
  ["I wonder what a little imagination can make from a cardboard box!", "Turn a box or blanket into a tiny elf hideaway.", "Creativity"],
  ["I noticed you kept trying, even when something felt tricky.", "Choose one small job and do it side by side.", "Trying together"],
  ["A warm story can make the whole room feel like a hug.", "Pick a favourite book and read one page each.", "Family connection"],
  ["The snowflakes are different, and every helpful act is special too.", "Make paper snowflakes and give one to someone you love.", "Thoughtfulness"],
  ["I heard a giggle bounce all the way to the North Pole!", "Make up a silly winter greeting and share it.", "Bringing joy"],
  ["A small thank-you can sparkle brighter than tinsel.", "Tell someone one thing you appreciate about them.", "Gratitude"],
  ["My little helper hands are ready. How can yours help today?", "Help set out napkins or cups for a family snack.", "Helping"],
  ["Quiet moments are magic too. Let's take one together.", "Pause for three slow breaths, then name something cosy.", "Calm and care"],
  ["A friend is someone who makes room for another person.", "Invite someone to join your game or choose a story together.", "Including others"],
  ["Your effort is a lovely gift, whatever the day looks like.", "Choose one toy or book to tidy together.", "Responsibility"],
  ["Could we make a little more wonder from what we already have?", "Make a decoration from paper you can recycle later.", "Creativity"],
  ["I spotted a brave try today. Every first step counts.", "Practise a small new skill together for five minutes.", "Courage"],
  ["The best surprises are the ones we make for each other.", "Leave a kind note or drawing for someone in your home.", "Kindness"],
  ["A good team listens, takes turns, and cheers each other on.", "Play a short turn-taking game together.", "Taking turns"],
  ["A little fresh air can shake the winter wiggles loose.", "Look for three interesting shapes outside or through a window.", "Curiosity"],
  ["Even the smallest helper can make a big difference.", "Match socks or help sort a small pile of laundry.", "Helping"],
  ["Today can be a day for making, resting, or both.", "Choose a calm craft, or simply draw one favourite thing.", "Self-expression"],
  ["I saved a twinkle for every time you tried again.", "Pick one puzzle or activity and work on it together.", "Perseverance"],
  ["Let's send a little cheer beyond our cosy corner.", "Wave or share a cheerful hello with someone you know.", "Connection"],
  ["Some of the loveliest magic is already right here.", "Name one thing you enjoyed doing together this week.", "Reflection"],
  ["The stars are brighter when we notice one another.", "Choose a family member's favourite song and listen together.", "Thoughtfulness"],
  ["Thank you for making room for kindness, silliness, and rest.", "Share one favourite countdown memory and celebrate together.", "Celebrating effort"],
] as const;

const DEMO_REWARDS = [
  { dayNumber: 2, label: "Choose tonight's story" },
  { dayNumber: 5, label: "Pick a family game" },
  { dayNumber: 9, label: "Cosy hot chocolate together" },
  { dayNumber: 12, label: "Choose a festive film" },
  { dayNumber: 18, label: "Pick the family playlist" },
  { dayNumber: 24, label: "A special family read-aloud" },
];

/** Called only inside first-creation or explicit recreation transactions, never on ordinary reads. */
async function seedPlannerRewards(tx: PlannerTransaction, plannerId: number) {
  const snapshots = new Map<number, { imageData: string; imageMime: string; templateId: number }>();
  for (const starter of STARTER_REWARDS) {
    const [inserted] = await tx.insert(plannerRewardTemplates).values({
      plannerId,
      label: starter.label,
      imageData: starter.imageData,
      imageMime: starter.imageMime,
    }).returning({ id: plannerRewardTemplates.id });
    snapshots.set(starter.dayNumber, {
      imageData: starter.imageData,
      imageMime: starter.imageMime,
      templateId: inserted.id,
    });
  }
  await tx.insert(plannerRewards).values(DEMO_REWARDS.map(reward => ({
    plannerId,
    ...reward,
    imageData: snapshots.get(reward.dayNumber)?.imageData ?? null,
    imageMime: snapshots.get(reward.dayNumber)?.imageMime ?? null,
    templateId: snapshots.get(reward.dayNumber)?.templateId ?? null,
    isRevealed: false,
  })));
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db;
}

function parentPlannerProjection(planner: typeof familyPlanners.$inferSelect) {
  return {
    id: planner.id,
    childDisplayName: planner.childDisplayName,
    countdownLength: planner.countdownLength,
    startDate: planner.startDate,
    isDeleted: planner.isDeleted,
    createdAt: planner.createdAt,
    updatedAt: planner.updatedAt,
  };
}

function childPlannerProjection(planner: typeof familyPlanners.$inferSelect) {
  return {
    childDisplayName: planner.childDisplayName,
    countdownLength: planner.countdownLength,
    startDate: planner.startDate,
    isDeleted: planner.isDeleted,
  };
}

export async function getOrCreateFamilyPlanner(userId: string) {
  const db = await requireDb();
  const existing = await db.select().from(familyPlanners).where(eq(familyPlanners.userId, userId)).limit(1);
  if (existing[0]) return existing[0];

  try {
    const plannerId = await db.transaction(async tx => {
      const [inserted] = await tx.insert(familyPlanners).values({
        userId,
        childDisplayName: "Little Helper",
        countdownLength: 12,
        startDate: "2026-12-01",
      }).returning({ id: familyPlanners.id });
      const newPlannerId = inserted.id;
      await tx.insert(plannerDays).values(DEMO_DAYS.map(([elfNote, activity, habitPrompt], index) => ({
        plannerId: newPlannerId, dayNumber: index + 1, elfNote, activity, habitPrompt, completed: false,
      })));
      await seedPlannerRewards(tx, newPlannerId);
      return newPlannerId;
    });
    const created = await db.select().from(familyPlanners).where(eq(familyPlanners.id, plannerId)).limit(1);
    if (!created[0]) throw new Error("Planner setup did not complete");
    return created[0];
  } catch (error) {
    // A concurrent first request can win the unique owner-row insert.
    const concurrent = await db.select().from(familyPlanners).where(eq(familyPlanners.userId, userId)).limit(1);
    if (concurrent[0]) return concurrent[0];
    throw error;
  }
}

export async function getPlannerPinStatus(userId: string) {
  const planner = await getOrCreateFamilyPlanner(userId);
  return { hasPin: Boolean(planner.parentPinHash), isDeleted: planner.isDeleted };
}

export async function getPlannerPinHash(userId: string) {
  const planner = await getOrCreateFamilyPlanner(userId);
  return planner.parentPinHash;
}

export async function setInitialPlannerPinHash(userId: string, parentPinHash: string) {
  const db = await requireDb();
  const planner = await getOrCreateFamilyPlanner(userId);
  if (planner.parentPinHash) return false;
  const updated = await db.update(familyPlanners).set({ parentPinHash })
    .where(and(eq(familyPlanners.id, planner.id), eq(familyPlanners.userId, userId), isNull(familyPlanners.parentPinHash)))
    .returning({ id: familyPlanners.id });
  return updated.length > 0;
}

export async function changePlannerPinHash(userId: string, parentPinHash: string) {
  const db = await requireDb();
  const planner = await getOrCreateFamilyPlanner(userId);
  await db.update(familyPlanners).set({ parentPinHash })
    .where(and(eq(familyPlanners.id, planner.id), eq(familyPlanners.userId, userId)));
  return { success: true };
}

export async function getPlannerOverview(userId: string) {
  const db = await requireDb();
  const planner = await getOrCreateFamilyPlanner(userId);
  const [days, rewards] = await Promise.all([
    db.select().from(plannerDays).where(eq(plannerDays.plannerId, planner.id)).orderBy(asc(plannerDays.dayNumber)),
    db.select().from(plannerRewards).where(eq(plannerRewards.plannerId, planner.id)).orderBy(asc(plannerRewards.dayNumber)),
  ]);
  return { planner: parentPlannerProjection(planner), days, rewards };
}

/** Locks the owner row against concurrent edits, but never seeds or writes content. */
export async function getFamilyBackupContent(userId: string) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [planner] = await tx.select({
      id: familyPlanners.id,
      childDisplayName: familyPlanners.childDisplayName,
      countdownLength: familyPlanners.countdownLength,
      startDate: familyPlanners.startDate,
      isDeleted: familyPlanners.isDeleted,
    }).from(familyPlanners).where(eq(familyPlanners.userId, userId)).limit(1).for("update");
    if (!planner || planner.isDeleted) throw new FamilyBackupError("missing");
    const days = await tx.select({
      dayNumber: plannerDays.dayNumber, elfNote: plannerDays.elfNote,
      activity: plannerDays.activity, habitPrompt: plannerDays.habitPrompt,
      completed: plannerDays.completed, completedAt: plannerDays.completedAt,
    }).from(plannerDays).where(eq(plannerDays.plannerId, planner.id))
      .orderBy(asc(plannerDays.dayNumber)).limit(24);
    const rewards = await tx.select({
      dayNumber: plannerRewards.dayNumber, label: plannerRewards.label,
      imageData: plannerRewards.imageData, imageMime: plannerRewards.imageMime,
      templateId: plannerRewards.templateId,
    }).from(plannerRewards).where(eq(plannerRewards.plannerId, planner.id))
      .orderBy(asc(plannerRewards.dayNumber)).limit(24);
    const templates: Pick<typeof plannerRewardTemplates.$inferSelect, "id" | "label" | "imageData" | "imageMime">[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await tx.select({
        id: plannerRewardTemplates.id, label: plannerRewardTemplates.label,
        imageData: plannerRewardTemplates.imageData, imageMime: plannerRewardTemplates.imageMime,
      }).from(plannerRewardTemplates).where(eq(plannerRewardTemplates.plannerId, planner.id))
        .orderBy(asc(plannerRewardTemplates.id)).limit(100).offset(offset);
      templates.push(...page);
      if (page.length < 100) break;
    }
    return buildFamilyBackupContent({ planner, days, rewards, templates });
  });
}

export async function getPlannerRewardTemplates(userId: string) {
  const db = await requireDb();
  const planner = await getOrCreateFamilyPlanner(userId);
  if (planner.isDeleted) return [];
  return db.select().from(plannerRewardTemplates)
    .where(eq(plannerRewardTemplates.plannerId, planner.id))
    .orderBy(asc(plannerRewardTemplates.createdAt));
}

export async function getChildPlannerView(userId: string) {
  const db = await requireDb();
  const planner = await getOrCreateFamilyPlanner(userId);
  if (planner.isDeleted) return { planner: childPlannerProjection(planner), days: [], rewards: [] };

  const days = await db.select({
    dayNumber: plannerDays.dayNumber,
    elfNote: plannerDays.elfNote,
    activity: plannerDays.activity,
    habitPrompt: plannerDays.habitPrompt,
    completed: plannerDays.completed,
  }).from(plannerDays)
    .where(and(eq(plannerDays.plannerId, planner.id), lte(plannerDays.dayNumber, planner.countdownLength)))
    .orderBy(asc(plannerDays.dayNumber));
  const rewardRows = await db.select({
    dayNumber: plannerRewards.dayNumber,
    label: plannerRewards.label,
    imageData: plannerRewards.imageData,
    imageMime: plannerRewards.imageMime,
  }).from(plannerRewards)
    .where(and(
      eq(plannerRewards.plannerId, planner.id),
      lte(plannerRewards.dayNumber, planner.countdownLength),
    ))
    .orderBy(asc(plannerRewards.dayNumber));
  const completedDayNumbers = new Set(days.filter(day => day.completed).map(day => day.dayNumber));
  const rewards = rewardRows.filter(reward => isRewardUnlockedForChild(reward.dayNumber, completedDayNumbers));
  // This projection intentionally excludes owner IDs, deletion metadata, PIN hash, templates, and locked rewards.
  return { planner: childPlannerProjection(planner), days, rewards };
}

export async function updatePlannerSettings(userId: string, values: {
  childDisplayName: string;
  countdownLength: number;
  startDate: string;
}) {
  const db = await requireDb();
  await getOrCreateFamilyPlanner(userId);
  await db.transaction(async tx => {
    const planner = await lockActivePlannerForUpdate(tx, userId);
    await tx.update(familyPlanners).set(values)
      .where(and(eq(familyPlanners.id, planner.id), eq(familyPlanners.userId, userId)));
  });
  return getPlannerOverview(userId);
}

export async function updatePlannerDay(userId: string, values: {
  dayNumber: number;
  elfNote: string;
  activity: string;
  habitPrompt: string | null;
}) {
  const db = await requireDb();
  await getOrCreateFamilyPlanner(userId);
  return db.transaction(async tx => {
    const planner = await lockActivePlannerForUpdate(tx, userId, values.dayNumber);
    const [existing] = await tx.select({ habitPrompt: plannerDays.habitPrompt, completed: plannerDays.completed })
      .from(plannerDays)
      .where(and(eq(plannerDays.plannerId, planner.id), eq(plannerDays.dayNumber, values.dayNumber)))
      .limit(1)
      .for("update");
    const targetChanged = existing?.habitPrompt !== values.habitPrompt;
    const completionReset = Boolean(existing?.completed && (targetChanged || !values.habitPrompt?.trim()));
    await tx.insert(plannerDays).values({ plannerId: planner.id, ...values })
      .onConflictDoUpdate({ target: [plannerDays.plannerId, plannerDays.dayNumber], set: {
        elfNote: values.elfNote,
        activity: values.activity,
        habitPrompt: values.habitPrompt,
        updatedAt: new Date(),
        ...(completionReset ? { completed: false, completedAt: null } : {}),
      } });
    return { success: true, completionReset };
  });
}

export async function setPlannerDayCompleted(userId: string, dayNumber: number, completed: boolean, expectedHabitPrompt: string | null) {
  const db = await requireDb();
  await getOrCreateFamilyPlanner(userId);
  return db.transaction(async tx => {
    const planner = await lockActivePlannerForUpdate(tx, userId, dayNumber);
    const [day] = await tx.select({ habitPrompt: plannerDays.habitPrompt }).from(plannerDays)
      .where(and(eq(plannerDays.plannerId, planner.id), eq(plannerDays.dayNumber, dayNumber)))
      .limit(1)
      .for("update");
    if (!day) throw new PlannerGuardError("inactive-day");
    assertExpectedBehaviourTarget(expectedHabitPrompt, day.habitPrompt);
    if (completed) assertGoodBehaviourTarget(day.habitPrompt);
    await tx.update(plannerDays)
      .set({ completed, completedAt: completed ? new Date() : null })
      .where(and(eq(plannerDays.plannerId, planner.id), eq(plannerDays.dayNumber, dayNumber)));
    return { success: true };
  });
}

export async function upsertPlannerReward(userId: string, values: {
  dayNumber: number;
  label: string;
  imageData: string | null;
  imageMime: string | null;
  templateId: number | null;
  saveAsTemplate: boolean;
}) {
  const db = await requireDb();
  await getOrCreateFamilyPlanner(userId);
  return db.transaction(async tx => {
    const planner = await lockActivePlannerForUpdate(tx, userId, values.dayNumber);
    let templateId = values.templateId;
    if (templateId !== null) {
      const ownedTemplate = await tx.select({ id: plannerRewardTemplates.id }).from(plannerRewardTemplates)
        .where(and(eq(plannerRewardTemplates.id, templateId), eq(plannerRewardTemplates.plannerId, planner.id))).limit(1);
      if (!ownedTemplate[0]) templateId = null;
    }

    if (values.saveAsTemplate) {
      if (!values.imageData || !values.imageMime) throw new Error("Add a matching elf picture before saving a reusable template.");
      if (templateId !== null) {
        await tx.update(plannerRewardTemplates).set({
          label: values.label,
          imageData: values.imageData,
          imageMime: values.imageMime,
        }).where(and(eq(plannerRewardTemplates.id, templateId), eq(plannerRewardTemplates.plannerId, planner.id)));
      } else {
        const [inserted] = await tx.insert(plannerRewardTemplates).values({
          plannerId: planner.id,
          label: values.label,
          imageData: values.imageData,
          imageMime: values.imageMime,
        }).returning({ id: plannerRewardTemplates.id });
        templateId = inserted.id;
      }
    }

    await tx.insert(plannerRewards).values({
      plannerId: planner.id,
      dayNumber: values.dayNumber,
      label: values.label,
      imageData: values.imageData,
      imageMime: values.imageMime,
      templateId,
      isRevealed: false,
    }).onConflictDoUpdate({ target: [plannerRewards.plannerId, plannerRewards.dayNumber], set: {
      label: values.label,
      imageData: values.imageData,
      imageMime: values.imageMime,
      templateId,
      isRevealed: false,
      updatedAt: new Date(),
    } });
    return { success: true, templateId };
  });
}

export async function updatePlannerRewardTemplate(userId: string, templateId: number, label: string, imageData: string, imageMime: string) {
  const db = await requireDb();
  await getOrCreateFamilyPlanner(userId);
  return db.transaction(async tx => {
    const planner = await lockActivePlannerForUpdate(tx, userId);
    const updated = await tx.update(plannerRewardTemplates).set({ label, imageData, imageMime })
      .where(and(eq(plannerRewardTemplates.id, templateId), eq(plannerRewardTemplates.plannerId, planner.id)))
      .returning({ id: plannerRewardTemplates.id });
    return updated.length > 0;
  });
}

export async function deletePlannerRewardTemplate(userId: string, templateId: number) {
  const db = await requireDb();
  await getOrCreateFamilyPlanner(userId);
  return db.transaction(async tx => {
    const planner = await lockActivePlannerForUpdate(tx, userId);
    await tx.update(plannerRewards).set({ templateId: null })
      .where(and(eq(plannerRewards.plannerId, planner.id), eq(plannerRewards.templateId, templateId)));
    const removed = await tx.delete(plannerRewardTemplates)
      .where(and(eq(plannerRewardTemplates.id, templateId), eq(plannerRewardTemplates.plannerId, planner.id)))
      .returning({ id: plannerRewardTemplates.id });
    return removed.length > 0;
  });
}

export async function clearPlannerRewardImage(userId: string, dayNumber: number) {
  const db = await requireDb();
  await getOrCreateFamilyPlanner(userId);
  return db.transaction(async tx => {
    const planner = await lockActivePlannerForUpdate(tx, userId, dayNumber);
    await tx.update(plannerRewards).set({ imageData: null, imageMime: null, templateId: null, isRevealed: false })
      .where(and(eq(plannerRewards.plannerId, planner.id), eq(plannerRewards.dayNumber, dayNumber)));
    return { success: true };
  });
}

export async function deletePlannerReward(userId: string, dayNumber: number) {
  const db = await requireDb();
  await getOrCreateFamilyPlanner(userId);
  return db.transaction(async tx => {
    const planner = await lockActivePlannerForUpdate(tx, userId, dayNumber);
    await tx.delete(plannerRewards)
      .where(and(eq(plannerRewards.plannerId, planner.id), eq(plannerRewards.dayNumber, dayNumber)));
    return { success: true };
  });
}

export async function deleteFamilyPlanner(userId: string) {
  const db = await requireDb();
  await getOrCreateFamilyPlanner(userId);
  return db.transaction(async tx => {
    const planner = await lockPlannerForUpdate(tx, userId);
    await tx.delete(plannerRewards).where(eq(plannerRewards.plannerId, planner.id));
    await tx.delete(plannerRewardTemplates).where(eq(plannerRewardTemplates.plannerId, planner.id));
    await tx.delete(plannerDays).where(eq(plannerDays.plannerId, planner.id));
    await tx.update(familyPlanners).set({
      childDisplayName: "Little Helper",
      countdownLength: 12,
      startDate: "2026-12-01",
      isDeleted: true,
    }).where(and(eq(familyPlanners.id, planner.id), eq(familyPlanners.userId, userId)));
    return { success: true };
  });
}

export async function createFreshFamilyPlanner(userId: string) {
  const db = await requireDb();
  await getOrCreateFamilyPlanner(userId);
  await db.transaction(async tx => {
    const planner = await lockPlannerForUpdate(tx, userId);
    if (!planner.isDeleted) return;
    // Clear any stale rows left by an interrupted older lifecycle before reseeding.
    await tx.delete(plannerRewards).where(eq(plannerRewards.plannerId, planner.id));
    await tx.delete(plannerRewardTemplates).where(eq(plannerRewardTemplates.plannerId, planner.id));
    await tx.delete(plannerDays).where(eq(plannerDays.plannerId, planner.id));
    await tx.update(familyPlanners).set({
      childDisplayName: "Little Helper",
      countdownLength: 12,
      startDate: "2026-12-01",
      isDeleted: false,
    }).where(and(eq(familyPlanners.id, planner.id), eq(familyPlanners.userId, userId)));
    await tx.insert(plannerDays).values(DEMO_DAYS.map(([elfNote, activity, habitPrompt], index) => ({
      plannerId: planner.id, dayNumber: index + 1, elfNote, activity, habitPrompt, completed: false,
    })));
    await seedPlannerRewards(tx, planner.id);
  });
  return getPlannerOverview(userId);
}
