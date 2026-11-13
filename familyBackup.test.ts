import { createHash, webcrypto } from "node:crypto";
import { eq, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { familyPlanners, plannerDays, plannerRewards, plannerRewardTemplates } from "../drizzle/schema";
import { collectFamilyBackup } from "../client/src/lib/familyBackupDownload";
import { getDb } from "./db";
import { getFamilyBackupContent } from "./plannerDb";
import { BACKUP_CHUNK_CHARS, BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, buildFamilyBackupContent, createFamilyBackupPart, FamilyBackupError } from "./familyBackup";

// Hoisted before plannerDb imports: the real production-shared DB module never loads.
vi.mock("./db", () => ({ getDb: vi.fn() }));

function syntheticRows() {
  const privateFields = {
    id: 81001, userId: "71001000-0000-4000-8000-000000000001", plannerId: 81001, parentPinHash: "SYNTHETIC_SECRET_PIN",
    email: "synthetic-account@example.invalid", openId: "SYNTHETIC_OPEN_ID",
    extraSecret: "SYNTHETIC_EXTRA_SECRET", createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  return {
    planner: { ...privateFields, childDisplayName: "Synthetic Helper", countdownLength: 12, startDate: "2026-12-01", isDeleted: false },
    days: Array.from({ length: 24 }, (_, index) => ({
      ...privateFields, dayNumber: index + 1, elfNote: `Synthetic note ${index + 1}`,
      activity: `Synthetic activity ${index + 1}`, habitPrompt: index === 0 ? null : "Try together",
      completed: index === 1, completedAt: index === 1 ? new Date("2026-12-02T12:34:56Z") : null,
    })).reverse(),
    rewards: Array.from({ length: 24 }, (_, index) => ({
      ...privateFields, dayNumber: index + 1, label: `Synthetic reward ${index + 1}`,
      imageData: index === 0 ? "data:image/jpeg;base64,U1lOVEhFVElDX1BIT1RP" : null,
      imageMime: index === 0 ? "image/jpeg" : null,
      templateId: index === 0 ? 91002 : index === 1 ? 99999 : null, isRevealed: false,
    })).reverse(),
    templates: [91002, 91001].map(id => ({
      ...privateFields, id, label: `Synthetic template ${id === 91001 ? "one" : "two"}`,
      imageData: "data:image/jpeg;base64,U1lOVEhFVElDX1RFTVBMQVRF", imageMime: "image/jpeg",
    })),
  };
}

function largeContent() {
  const content = buildFamilyBackupContent(syntheticRows());
  // Deliberately larger than two chunks, including non-ASCII family text.
  content.rewards[0].imageData = `data:image/jpeg;base64,${"A".repeat(BACKUP_CHUNK_CHARS * 2)}`;
  content.days[0].elfNote = "Synthetic snowman ☃ and elf 🧝";
  return content;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockImplementation(async () => { throw new Error("Unconfigured database mock; real access forbidden"); });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("family backup allowlist and multipart integrity", () => {
  it("preserves all 24 days and rewards, inactive content, nulls, progress, photos and local template links only", () => {
    const input = syntheticRows();
    const content = buildFamilyBackupContent(input);
    expect(content.planner).toEqual({ childDisplayName: "Synthetic Helper", countdownLength: 12, startDate: "2026-12-01" });
    expect(content.days.map(day => day.dayNumber)).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
    expect(content.rewards.map(reward => reward.dayNumber)).toEqual(content.days.map(day => day.dayNumber));
    expect(content.days[0]).toEqual({ dayNumber: 1, elfNote: "Synthetic note 1", activity: "Synthetic activity 1", habitPrompt: null, completed: false, completedAt: null });
    expect(content.days[1].completedAt).toBe("2026-12-02T12:34:56.000Z");
    expect(content.days[1].completed).toBe(true);
    expect(content.days[23].elfNote).toBe("Synthetic note 24");
    expect(content.rewards[0]).toEqual({ dayNumber: 1, label: "Synthetic reward 1", imageData: input.rewards[23].imageData, imageMime: "image/jpeg", sourceTemplateRef: "template-2" });
    expect(content.rewards[1]).toEqual({ dayNumber: 2, label: "Synthetic reward 2", imageData: null, imageMime: null, sourceTemplateRef: null });
    expect(content.rewards[23].sourceTemplateRef).toBeNull();
    expect(content.templates).toEqual([
      { ref: "template-1", label: "Synthetic template one", imageData: input.templates[1].imageData, imageMime: "image/jpeg" },
      { ref: "template-2", label: "Synthetic template two", imageData: input.templates[0].imageData, imageMime: "image/jpeg" },
    ]);
    const serialized = createFamilyBackupPart(content, 0).chunk;
    for (const secret of ["SYNTHETIC_SECRET_PIN", "SYNTHETIC_OPEN_ID", "SYNTHETIC_EXTRA_SECRET", "synthetic-account@example.invalid"]) expect(serialized).not.toContain(secret);
    const forbiddenKeys = ["id", "userId", "plannerId", "parentPinHash", "email", "openId", "extraSecret", "createdAt", "isDeleted", "isRevealed", "templateId"];
    for (const key of forbiddenKeys) expect(serialized).not.toContain(`"${key}":`);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("sorts without mutating input and hashes identically regardless of source row order or export time", () => {
    const input = syntheticRows();
    const before = structuredClone(input);
    const first = createFamilyBackupPart(buildFamilyBackupContent(input), 0);
    const shuffled = { ...input, days: [...input.days].reverse(), rewards: [...input.rewards].reverse(), templates: [...input.templates].reverse() };
    const second = createFamilyBackupPart(buildFamilyBackupContent(shuffled), 0);
    expect(second.chunk).toBe(first.chunk);
    expect(second.sha256).toBe(first.sha256);
    expect(first.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isNaN(Date.parse(first.exportedAt))).toBe(false);
    expect(input).toEqual(before);
  });

  it("reassembles every bounded chunk and verifies SHA-256 against the entire UTF-8 document", () => {
    const content = largeContent();
    const first = createFamilyBackupPart(content, 0);
    expect(first.totalParts).toBeGreaterThan(2);
    const parts = Array.from({ length: first.totalParts }, (_, part) => createFamilyBackupPart(content, part, first.sha256));
    parts.forEach((part, index) => {
      expect(part).toMatchObject({ format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, part: index, totalParts: first.totalParts, sha256: first.sha256 });
      expect(part.chunk.length).toBeLessThanOrEqual(BACKUP_CHUNK_CHARS);
      if (index < first.totalParts - 1) expect(part.chunk.length).toBe(BACKUP_CHUNK_CHARS);
    });
    const serialized = parts.map(part => part.chunk).join("");
    expect(JSON.parse(serialized)).toEqual({ format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, content });
    expect(createHash("sha256").update(serialized, "utf8").digest("hex")).toBe(first.sha256);
    expect(first.totalParts).toBe(Math.ceil(serialized.length / BACKUP_CHUNK_CHARS));
  });

  it("rejects a changed snapshot rather than mixing old and new parts", () => {
    const content = largeContent();
    const first = createFamilyBackupPart(content, 0);
    content.days[0].elfNote = "Synthetic changed note";
    expect(() => createFamilyBackupPart(content, 1, first.sha256)).toThrowError(expect.objectContaining({ reason: "changed" }));
    expect(() => createFamilyBackupPart(content, 0, first.sha256)).toThrowError(FamilyBackupError);
  });

  it("rejects invalid, out-of-range and continuation parts without the initial snapshot hash", () => {
    const content = largeContent();
    const first = createFamilyBackupPart(content, 0);
    for (const part of [-1, 0.5, NaN, Infinity, first.totalParts]) {
      expect(() => createFamilyBackupPart(content, part, first.sha256)).toThrowError(expect.objectContaining({ reason: "part" }));
    }
    expect(() => createFamilyBackupPart(content, 1)).toThrowError(expect.objectContaining({ reason: "part" }));
    expect(() => createFamilyBackupPart(content, 1, "")).toThrowError(expect.objectContaining({ reason: "part" }));
  });

  it("lets the client collect and verify synthetic parts using the first hash and the same abort signal", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const content = largeContent();
    const signal = new AbortController().signal;
    const requestPart = vi.fn(async (input: { part: number; expectedHash?: string }, receivedSignal: AbortSignal) => {
      expect(receivedSignal).toBe(signal);
      return createFamilyBackupPart(content, input.part, input.expectedHash);
    });
    const document = await collectFamilyBackup(requestPart, signal);
    const first = createFamilyBackupPart(content, 0);
    expect(document).toMatchObject({ format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, content, contentSha256: first.sha256 });
    expect(requestPart).toHaveBeenCalledTimes(first.totalParts);
    expect(requestPart.mock.calls[0][0]).toEqual({ part: 0 });
    requestPart.mock.calls.slice(1).forEach(([input], index) => expect(input).toEqual({ part: index + 1, expectedHash: first.sha256 }));
    expect(getDb).not.toHaveBeenCalled();
  });
});

type Table = typeof familyPlanners | typeof plannerDays | typeof plannerRewards | typeof plannerRewardTemplates;
type Read = { table: Table; rows: unknown[]; columns: string[]; condition: SQL; limit: number; offset?: number };
const dialect = new MySqlDialect();

function mockReadOnlyDatabase(reads: Read[]) {
  const remaining = [...reads];
  const blocked = (kind: string) => vi.fn(() => { throw new Error(`Backup must not ${kind}`); });
  const locks = vi.fn();
  const tx = {
    insert: blocked("insert"), update: blocked("update"), delete: blocked("delete"),
    select: vi.fn((projection: Record<string, unknown>) => ({
      from: vi.fn((table: Table) => {
        const read = remaining.shift();
        if (!read) throw new Error("Unexpected synthetic database read");
        expect(table).toBe(read.table);
        expect(Object.keys(projection).sort()).toEqual([...read.columns].sort());
        for (const [key, column] of Object.entries(projection)) expect(column).toBe(table[key as keyof Table]);
        const result = Promise.resolve(read.rows);
        const query = {
          where: vi.fn((condition: SQL) => {
            // Compile SQL locally only: equality must use session owner, then that owner's planner ID.
            expect(dialect.sqlToQuery(condition)).toEqual(dialect.sqlToQuery(read.condition));
            return query;
          }),
          orderBy: vi.fn((_order: SQL) => query),
          limit: vi.fn((limit: number) => {
            expect(limit).toBe(read.limit);
            return Object.assign(result, {
              for: vi.fn((lock: string) => { expect(table).toBe(familyPlanners); expect(lock).toBe("update"); locks(lock); return result; }),
              offset: vi.fn((offset: number) => { expect(offset).toBe(read.offset); return result; }),
            });
          }),
        };
        return query;
      }),
    })),
  };
  const db = {
    select: blocked("read outside the owner transaction"),
    insert: blocked("insert"), update: blocked("update"), delete: blocked("delete"),
    transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  vi.mocked(getDb).mockResolvedValue(db as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>);
  return { db, tx, locks, remaining };
}

function expectReadOnly(mock: ReturnType<typeof mockReadOnlyDatabase>) {
  for (const scope of [mock.db, mock.tx]) {
    expect(scope.insert).not.toHaveBeenCalled();
    expect(scope.update).not.toHaveBeenCalled();
    expect(scope.delete).not.toHaveBeenCalled();
  }
  expect(mock.db.select).not.toHaveBeenCalled();
  expect(mock.db.transaction).toHaveBeenCalledTimes(1);
  expect(mock.locks).toHaveBeenCalledTimes(1);
  expect(mock.locks).toHaveBeenCalledWith("update");
  expect(mock.remaining).toEqual([]);
}

function ownerRead(userId: string, rows: unknown[]): Read {
  return { table: familyPlanners, rows, columns: ["id", "childDisplayName", "countdownLength", "startDate", "isDeleted"], condition: eq(familyPlanners.userId, userId), limit: 1 };
}

describe("read-only family backup database getter", () => {
  it.each([{ userId: "71001000-0000-4000-8000-000000000001", plannerId: 81001 }, { userId: "71002000-0000-4000-8000-000000000002", plannerId: 81002 }])("locks owner $userId and reads only planner $plannerId, including inactive days and paginated templates", async ({ userId, plannerId }) => {
    const input = syntheticRows();
    input.planner.id = plannerId;
    input.planner.userId = userId;
    input.templates = Array.from({ length: 101 }, (_, index) => ({ ...input.templates[0], id: 91001 + index, label: `Synthetic template ${index + 1}` }));
    input.rewards[0].templateId = input.templates[100].id;
    const mock = mockReadOnlyDatabase([
      ownerRead(userId, [input.planner]),
      { table: plannerDays, rows: input.days, columns: ["dayNumber", "elfNote", "activity", "habitPrompt", "completed", "completedAt"], condition: eq(plannerDays.plannerId, plannerId), limit: 24 },
      { table: plannerRewards, rows: input.rewards, columns: ["dayNumber", "label", "imageData", "imageMime", "templateId"], condition: eq(plannerRewards.plannerId, plannerId), limit: 24 },
      ...[0, 100].map(offset => ({ table: plannerRewardTemplates, rows: input.templates.slice(offset, offset + 100), columns: ["id", "label", "imageData", "imageMime"], condition: eq(plannerRewardTemplates.plannerId, plannerId), limit: 100, offset })),
    ]);
    const content = await getFamilyBackupContent(userId);
    expect(content).toEqual(buildFamilyBackupContent(input));
    expect(content.days).toHaveLength(24);
    expect(content.rewards).toHaveLength(24);
    expect(content.templates).toHaveLength(101);
    expect(content.rewards[23].sourceTemplateRef).toBe("template-101");
    expect(mock.tx.select).toHaveBeenCalledTimes(5);
    expectReadOnly(mock);
  });

  it.each(["missing", "deleted"])("refuses a %s planner without reading family content, creating or changing anything", async state => {
    const planner = { ...syntheticRows().planner, isDeleted: true };
    const mock = mockReadOnlyDatabase([ownerRead(planner.userId, state === "missing" ? [] : [planner])]);
    await expect(getFamilyBackupContent(planner.userId)).rejects.toMatchObject({ reason: "missing" });
    expect(mock.tx.select).toHaveBeenCalledTimes(1);
    expectReadOnly(mock);
  });
});
