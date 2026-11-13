export type PlannerGuardReason = "deleted" | "inactive-day" | "missing-behaviour" | "target-changed";

export class PlannerGuardError extends Error {
  constructor(public readonly reason: PlannerGuardReason) {
    super(reason === "deleted"
      ? "Start a fresh countdown before changing this planner."
      : reason === "inactive-day"
        ? "That day is outside the active countdown length."
        : reason === "missing-behaviour"
          ? "Add a good behaviour target for this day before checking it off."
          : "This good behaviour changed in another view. Refresh the planner before checking it off again.");
    this.name = "PlannerGuardError";
  }
}

export function assertPlannerNotDeleted(isDeleted: boolean) {
  if (isDeleted) throw new PlannerGuardError("deleted");
}

export function assertActiveCountdownDay(isDeleted: boolean, countdownLength: number, dayNumber: number) {
  assertPlannerNotDeleted(isDeleted);
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > countdownLength || dayNumber > 24) {
    throw new PlannerGuardError("inactive-day");
  }
}

export function isRewardUnlockedForChild(dayNumber: number, completedDayNumbers: ReadonlySet<number>) {
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 24) return false;
  return dayNumber === 1 || completedDayNumbers.has(dayNumber - 1);
}

export function assertGoodBehaviourTarget(target: string | null | undefined) {
  if (!target?.trim()) throw new PlannerGuardError("missing-behaviour");
}

export function assertExpectedBehaviourTarget(expected: string | null, current: string | null | undefined) {
  if ((current ?? null) !== expected) throw new PlannerGuardError("target-changed");
}
