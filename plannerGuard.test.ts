import { describe, expect, it } from "vitest";
import { assertActiveCountdownDay, assertExpectedBehaviourTarget, assertGoodBehaviourTarget, assertPlannerNotDeleted, isRewardUnlockedForChild, PlannerGuardError } from "./plannerGuard";

describe("planner lifecycle guards", () => {
  it("rejects settings changes on a deleted planner until explicit recreation", () => {
    expect(() => assertPlannerNotDeleted(false)).not.toThrow();
    expect(() => assertPlannerNotDeleted(true)).toThrowError(PlannerGuardError);
    expect(() => assertPlannerNotDeleted(true)).toThrow(/fresh countdown/);
  });

  it("accepts only days within the selected active countdown", () => {
    expect(() => assertActiveCountdownDay(false, 12, 12)).not.toThrow();
    expect(() => assertActiveCountdownDay(false, 24, 24)).not.toThrow();
    expect(() => assertActiveCountdownDay(false, 12, 13)).toThrowError(PlannerGuardError);
    expect(() => assertActiveCountdownDay(true, 24, 1)).toThrow(/fresh countdown/);
  });

  it("rejects a stale day mutation after a 24-to-12 change or planner deletion", () => {
    const livePlanner = { isDeleted: false, countdownLength: 24 };
    const validateDayThirteen = () => assertActiveCountdownDay(livePlanner.isDeleted, livePlanner.countdownLength, 13);
    expect(validateDayThirteen).not.toThrow();

    livePlanner.countdownLength = 12;
    expect(validateDayThirteen).toThrow(/outside the active countdown/);

    livePlanner.isDeleted = true;
    expect(() => assertActiveCountdownDay(livePlanner.isDeleted, livePlanner.countdownLength, 1)).toThrow(/fresh countdown/);
  });

  it("requires a parent-defined good behaviour before a day can be checked off", () => {
    expect(() => assertGoodBehaviourTarget("Help tidy a few toys together")).not.toThrow();
    expect(() => assertGoodBehaviourTarget(null)).toThrowError(PlannerGuardError);
    expect(() => assertGoodBehaviourTarget("   ")).toThrow(/Add a good behaviour target/);
  });

  it("rejects a check-off if the displayed behaviour changed in another view", () => {
    expect(() => assertExpectedBehaviourTarget("Help tidy toys", "Help tidy toys")).not.toThrow();
    expect(() => assertExpectedBehaviourTarget("Help tidy toys", "Put shoes away")).toThrow(/changed in another view/);
    expect(() => assertExpectedBehaviourTarget(null, "Put shoes away")).toThrowError(PlannerGuardError);
  });

  it("unlocks day one at the start and each next-day reward after its previous day is complete", () => {
    expect(isRewardUnlockedForChild(1, new Set())).toBe(true);
    expect(isRewardUnlockedForChild(2, new Set())).toBe(false);
    expect(isRewardUnlockedForChild(2, new Set([1]))).toBe(true);
    expect(isRewardUnlockedForChild(4, new Set([2]))).toBe(false);
    expect(isRewardUnlockedForChild(4, new Set([3]))).toBe(true);
    expect(isRewardUnlockedForChild(25, new Set([24]))).toBe(false);
  });
});
