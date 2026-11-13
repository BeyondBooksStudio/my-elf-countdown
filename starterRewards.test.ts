import { beforeEach, describe, expect, it, vi } from "vitest";
import { familyPlanners, plannerDays, plannerRewards, plannerRewardTemplates } from "../drizzle/schema";
import { getDb } from "./db";
import { createFreshFamilyPlanner, getOrCreateFamilyPlanner, getPlannerRewardTemplates } from "./plannerDb";
import { validateRewardImageData } from "./plannerSecurity";
import { STARTER_REWARDS } from "./starterRewards";

// Never load the real database module or connect to the shared database.
vi.mock("./db", () => ({ getDb: vi.fn() }));

type Table = typeof familyPlanners | typeof plannerDays | typeof plannerRewards | typeof plannerRewardTemplates;
type Planner = typeof familyPlanners.$inferSelect;
type Row = Record<string, unknown>;
type Read = { table: Table; rows: unknown[] };
type Insert = { table: Table; rows: Row[]; insertId: number; transactionId: number };

const USER_A = "11111111-1111-4111-8111-111111111111";

function planner(id: number, userId: string, isDeleted = false): Planner {
  return {
    id, userId, isDeleted,
    childDisplayName: "My edited child name",
    countdownLength: 24,
    startDate: "2026-12-03",
    parentPinHash: "existing-private-pin-hash",
    createdAt: new Date("2026-11-01T00:00:00Z"),
    updatedAt: new Date("2026-11-02T00:00:00Z"),
  };
}

function mockSelect(reads: Read[]) {
  return vi.fn((_projection?: unknown) => ({
    from: vi.fn((table: Table) => {
      const read = reads.shift();
      if (!read) throw new Error("Unexpected database read in test");
      expect(table).toBe(read.table);
      const result = Promise.resolve(read.rows);
      return {
        where: vi.fn((_condition: unknown) => ({
          limit: vi.fn((limit: number) => {
            expect(limit).toBe(1);
            return Object.assign(result, { for: vi.fn((_lock: string) => result) });
          }),
          orderBy: vi.fn((_order: unknown) => result),
        })),
      };
    }),
  }));
}

function mockDatabase(options: {
  reads: Read[];
  lockedPlanners?: Planner[];
  failTable?: Table;
  failOccurrence?: number;
}) {
  const reads = [...options.reads];
  const lockReads = (options.lockedPlanners ?? []).map(row => ({ table: familyPlanners, rows: [row] }));
  const attempts: Insert[] = [];
  const committed: Insert[] = [];
  const mutations: { table: Table; kind: "update" | "delete"; transactionId: number }[] = [];
  const transactions: { id: number; status: "running" | "committed" | "rolled-back" }[] = [];
  let nextId = 1000;
  let failTableInserts = 0;
  const insertionError = new Error("Starter reward insertion failed");
  const txSelect = mockSelect(lockReads);
  const db = {
    select: mockSelect(reads),
    insert: vi.fn(() => { throw new Error("Insert outside transaction"); }),
    update: vi.fn(() => { throw new Error("Update outside transaction"); }),
    delete: vi.fn(() => { throw new Error("Delete outside transaction"); }),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const transaction = { id: transactions.length + 1, status: "running" as "running" | "committed" | "rolled-back" };
      transactions.push(transaction);
      const pending: Insert[] = [];
      const tx = {
        select: txSelect,
        insert: vi.fn((table: Table) => ({
          values: vi.fn((values: Row | Row[]) => {
            const insertion: Insert = {
              table, rows: Array.isArray(values) ? values : [values],
              insertId: nextId++, transactionId: transaction.id,
            };
            attempts.push(insertion);
            if (table === options.failTable && ++failTableInserts === (options.failOccurrence ?? 1)) {
              throw insertionError;
            }
            pending.push(insertion);
            // Postgres inserts can be awaited directly or asked to .returning() the new row.
            return Object.assign(Promise.resolve([{ id: insertion.insertId }]), {
              returning: vi.fn((_columns?: unknown) => Promise.resolve([{ id: insertion.insertId }])),
            });
          }),
        })),
        update: vi.fn((table: Table) => ({
          set: vi.fn((_values: Row) => ({
            where: vi.fn((_condition: unknown) => {
              mutations.push({ table, kind: "update", transactionId: transaction.id });
              return Object.assign(Promise.resolve([{ id: 1 }]), { returning: vi.fn((_columns?: unknown) => Promise.resolve([{ id: 1 }])) });
            }),
          })),
        })),
        delete: vi.fn((table: Table) => ({
          where: vi.fn((_condition: unknown) => {
            mutations.push({ table, kind: "delete", transactionId: transaction.id });
            return Object.assign(Promise.resolve([{ id: 1 }]), { returning: vi.fn((_columns?: unknown) => Promise.resolve([{ id: 1 }])) });
          }),
        })),
      };
      try {
        const result = await callback(tx);
        committed.push(...pending);
        transaction.status = "committed";
        return result;
      } catch (error) {
        transaction.status = "rolled-back";
        throw error;
      }
    }),
  };
  vi.mocked(getDb).mockResolvedValue(db as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>);
  return { db, attempts, committed, mutations, transactions, insertionError, reads, lockReads, txSelect };
}

function assertSeededRewards(inserts: Insert[], plannerId: number) {
  const templates = inserts.filter(insert => insert.table === plannerRewardTemplates);
  expect(templates).toHaveLength(4);
  const rewardInserts = inserts.filter(insert => insert.table === plannerRewards);
  expect(rewardInserts).toHaveLength(1);
  const rewards = rewardInserts[0].rows;
  expect(rewards).toHaveLength(6);
  for (const [index, starter] of STARTER_REWARDS.entries()) {
    expect(templates[index].rows).toEqual([{
      plannerId, label: starter.label, imageData: starter.imageData, imageMime: starter.imageMime,
    }]);
    expect(templates[index].rows[0]).not.toBe(starter);
    expect(rewards[index]).toEqual({
      plannerId, dayNumber: starter.dayNumber, label: starter.label,
      imageData: starter.imageData, imageMime: starter.imageMime,
      templateId: templates[index].insertId, isRevealed: false,
    });
    expect(rewards[index]).not.toBe(templates[index].rows[0]);
  }
  expect(rewards.slice(4)).toEqual([
    { plannerId, dayNumber: 18, label: "Pick the family playlist", imageData: null, imageMime: null, templateId: null, isRevealed: false },
    { plannerId, dayNumber: 24, label: "A special family read-aloud", imageData: null, imageMime: null, templateId: null, isRevealed: false },
  ]);
  return { templates, rewards };
}

function assertNoWrites(mock: ReturnType<typeof mockDatabase>) {
  expect(mock.db.transaction).not.toHaveBeenCalled();
  expect(mock.db.insert).not.toHaveBeenCalled();
  expect(mock.db.update).not.toHaveBeenCalled();
  expect(mock.db.delete).not.toHaveBeenCalled();
  expect(mock.attempts).toEqual([]);
  expect(mock.mutations).toEqual([]);
}

beforeEach(() => { vi.clearAllMocks(); });

describe("starter reward artwork", () => {
  it("contains only the four matching sample reward/day pairs", () => {
    expect(STARTER_REWARDS.map(({ dayNumber, label }) => ({ dayNumber, label }))).toEqual([
      { dayNumber: 2, label: "Choose tonight's story" },
      { dayNumber: 5, label: "Pick a family game" },
      { dayNumber: 9, label: "Cosy hot chocolate together" },
      { dayNumber: 12, label: "Choose a festive film" },
    ]);
    expect(new Set(STARTER_REWARDS.map(reward => reward.imageData)).size).toBe(4);
  });

  it.each(STARTER_REWARDS)("fully decodes the normalized JPEG for day $dayNumber ($label)", starter => {
    expect(starter.imageMime).toBe("image/jpeg");
    expect(validateRewardImageData(starter.imageData)).toEqual({
      imageData: starter.imageData, imageMime: "image/jpeg",
    });
  });
});

describe("starter reward planner lifecycle", () => {
  it("creates four parent-owned templates and six day snapshots in the planner's transaction", async () => {
    const created = planner(1000, USER_A);
    const mock = mockDatabase({ reads: [
      { table: familyPlanners, rows: [] },
      { table: familyPlanners, rows: [created] },
    ] });

    expect(await getOrCreateFamilyPlanner(USER_A)).toBe(created);
    expect(mock.db.transaction).toHaveBeenCalledTimes(1);
    expect(mock.committed[0].table).toBe(familyPlanners);
    expect(mock.committed[0].rows).toEqual([{
      userId: USER_A, childDisplayName: "Little Helper", countdownLength: 12, startDate: "2026-12-01",
    }]);
    const dayInsert = mock.committed.find(insert => insert.table === plannerDays)!;
    expect(dayInsert.rows).toHaveLength(24);
    expect(dayInsert.rows.every(row => row.plannerId === created.id && row.completed === false)).toBe(true);
    assertSeededRewards(mock.committed, created.id);
    expect(new Set(mock.committed.map(insert => insert.transactionId))).toEqual(new Set([1]));
    expect(mock.transactions).toEqual([{ id: 1, status: "committed" }]);
    expect(mock.db.insert).not.toHaveBeenCalled();
    expect(mock.reads).toEqual([]);
  });

  it("makes separate planner/template IDs and independent snapshots for two new parents", async () => {
    // Each first-creation transaction performs seven inserts (planner, days, four templates, rewards).
    const first = planner(1000, USER_A);
    const second = planner(1007, 202);
    const mock = mockDatabase({ reads: [
      { table: familyPlanners, rows: [] }, { table: familyPlanners, rows: [first] },
      { table: familyPlanners, rows: [] }, { table: familyPlanners, rows: [second] },
    ] });

    expect(await getOrCreateFamilyPlanner(USER_A)).toBe(first);
    expect(await getOrCreateFamilyPlanner(202)).toBe(second);
    const firstInserts = mock.committed.filter(insert => insert.transactionId === 1);
    const secondInserts = mock.committed.filter(insert => insert.transactionId === 2);
    expect(firstInserts[0].rows[0].userId).toBe(USER_A);
    expect(secondInserts[0].rows[0].userId).toBe(202);
    const firstSeed = assertSeededRewards(firstInserts, first.id);
    const secondSeed = assertSeededRewards(secondInserts, second.id);
    const firstTemplateIds = new Set(firstSeed.templates.map(insert => insert.insertId));
    expect(secondSeed.templates.every(insert => !firstTemplateIds.has(insert.insertId))).toBe(true);
    expect(secondSeed.rewards.every(row => row.plannerId !== first.id)).toBe(true);
    expect(firstSeed.rewards[0]).not.toBe(secondSeed.rewards[0]);
    firstSeed.templates[0].rows[0].label = "Only the first parent's edit";
    expect(firstSeed.rewards[0].label).toBe(STARTER_REWARDS[0].label);
    expect(secondSeed.templates[0].rows[0].label).toBe(STARTER_REWARDS[0].label);
    expect(secondSeed.rewards[0].label).toBe(STARTER_REWARDS[0].label);
    expect(mock.db.transaction).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("returns an existing planner (isDeleted=$0) unchanged without any seeding", async isDeleted => {
    const existing = planner(77, USER_A, isDeleted);
    const mock = mockDatabase({ reads: [{ table: familyPlanners, rows: [existing] }] });
    expect(await getOrCreateFamilyPlanner(USER_A)).toBe(existing);
    assertNoWrites(mock);
    expect(mock.db.select).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "edited", rows: [{ id: 88, plannerId: 77, label: "Parent's custom reward", imageData: "parent's own image", imageMime: "image/jpeg" }] },
    { name: "fully deleted", rows: [] },
  ])("leaves an existing $name template library untouched rather than restoring starters", async ({ rows }) => {
    const mock = mockDatabase({ reads: [
      { table: familyPlanners, rows: [planner(77, USER_A)] },
      { table: plannerRewardTemplates, rows },
    ] });
    expect(await getPlannerRewardTemplates(USER_A)).toBe(rows);
    assertNoWrites(mock);
    expect(mock.reads).toEqual([]);
  });

  it.each([
    { name: "a later template", table: plannerRewardTemplates, occurrence: 2 },
    { name: "the day reward snapshots", table: plannerRewards, occurrence: 1 },
  ])("rejects creation when inserting $name fails, without returning an uncommitted planner", async ({ table, occurrence }) => {
    const mock = mockDatabase({
      reads: [
        { table: familyPlanners, rows: [] },
        // A real rollback leaves no owner row for the concurrency recovery read.
        { table: familyPlanners, rows: [] },
      ],
      failTable: table, failOccurrence: occurrence,
    });
    await expect(getOrCreateFamilyPlanner(USER_A)).rejects.toBe(mock.insertionError);
    expect(mock.attempts[0].table).toBe(familyPlanners);
    expect(mock.attempts.at(-1)?.table).toBe(table);
    expect(mock.committed).toEqual([]);
    expect(mock.transactions).toEqual([{ id: 1, status: "rolled-back" }]);
    expect(mock.db.select).toHaveBeenCalledTimes(2);
    expect(mock.reads).toEqual([]);
  });

  it("explicitly recreates a deleted planner once, but does not reseed on an active repeat", async () => {
    const deleted = planner(77, USER_A, true);
    const active = planner(77, USER_A);
    const overviewReads = (): Read[] => [
      { table: familyPlanners, rows: [active] },
      { table: plannerDays, rows: [] },
      { table: plannerRewards, rows: [] },
    ];
    const mock = mockDatabase({
      reads: [
        { table: familyPlanners, rows: [deleted] }, ...overviewReads(),
        { table: familyPlanners, rows: [active] }, ...overviewReads(),
      ],
      lockedPlanners: [deleted, active],
    });

    expect((await createFreshFamilyPlanner(USER_A)).planner.isDeleted).toBe(false);
    assertSeededRewards(mock.committed, deleted.id);
    expect(mock.committed.filter(insert => insert.table === familyPlanners)).toEqual([]);
    expect(mock.mutations).toEqual([
      { table: plannerRewards, kind: "delete", transactionId: 1 },
      { table: plannerRewardTemplates, kind: "delete", transactionId: 1 },
      { table: plannerDays, kind: "delete", transactionId: 1 },
      { table: familyPlanners, kind: "update", transactionId: 1 },
    ]);
    const insertCount = mock.attempts.length;
    const mutationCount = mock.mutations.length;
    expect((await createFreshFamilyPlanner(USER_A)).planner.isDeleted).toBe(false);
    expect(mock.attempts).toHaveLength(insertCount);
    expect(mock.mutations).toHaveLength(mutationCount);
    expect(mock.committed.every(insert => insert.transactionId === 1)).toBe(true);
    expect(mock.db.transaction).toHaveBeenCalledTimes(2);
    expect(mock.txSelect).toHaveBeenCalledTimes(2);
    expect(mock.reads).toEqual([]);
    expect(mock.lockReads).toEqual([]);
  });
});
