import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectFamilyBackup } from "../client/src/lib/familyBackupDownload";
import { BACKUP_CHUNK_CHARS, buildFamilyBackupContent, createFamilyBackupPart } from "./familyBackup";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); });

function syntheticParts() {
  const content = buildFamilyBackupContent({
    planner: { childDisplayName: "Synthetic collector helper", countdownLength: 12, startDate: "2026-12-01" },
    days: [], templates: [],
    rewards: [{ dayNumber: 24, label: "Synthetic photo", imageData: `data:image/jpeg;base64,${"A".repeat(BACKUP_CHUNK_CHARS)}`, imageMime: "image/jpeg", templateId: null }],
  });
  const first = createFamilyBackupPart(content, 0);
  return Array.from({ length: first.totalParts }, (_, part) => createFamilyBackupPart(content, part, first.sha256));
}

describe("client family backup collector rejection boundaries", () => {
  // Successful multipart collection is covered in familyBackup.test.ts.
  it("rejects a tampered chunk even when all metadata and advertised hashes still match", async () => {
    const parts = syntheticParts();
    parts[1] = { ...parts[1], chunk: parts[1].chunk.replace("A", "B") };
    const request = vi.fn(async ({ part }: { part: number }) => parts[part]);
    await expect(collectFamilyBackup(request, new AbortController().signal)).rejects.toThrow(/could not be verified/);
    expect(request).toHaveBeenCalledTimes(parts.length);
  });

  it("rejects inconsistent continuation metadata before assembling the backup", async () => {
    const parts = syntheticParts();
    parts[1] = { ...parts[1], part: 0, sha256: "f".repeat(64) };
    const request = vi.fn(async ({ part }: { part: number }) => parts[part]);
    await expect(collectFamilyBackup(request, new AbortController().signal)).rejects.toThrow(/changed during download/);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("makes no requests when already aborted and stops requesting further parts after cancellation", async () => {
    const parts = syntheticParts();
    const beforeStart = new AbortController();
    beforeStart.abort();
    const neverRequested = vi.fn(async () => parts[0]);
    await expect(collectFamilyBackup(neverRequested, beforeStart.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(neverRequested).not.toHaveBeenCalled();

    const duringDownload = new AbortController();
    const request = vi.fn(async () => { duringDownload.abort(); return parts[0]; });
    await expect(collectFamilyBackup(request, duringDownload.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
