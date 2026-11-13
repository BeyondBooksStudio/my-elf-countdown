type BackupPart = {
  format: string;
  schemaVersion: number;
  exportedAt: string;
  part: number;
  totalParts: number;
  sha256: string;
  chunk: string;
};

type RequestPart = (input: { part: number; expectedHash?: string }, signal: AbortSignal) => Promise<BackupPart>;

function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Backup download cancelled", "AbortError");
}

/** All private data stays in this local scope, not a React Query or browser storage cache. */
export async function collectFamilyBackup(requestPart: RequestPart, signal: AbortSignal) {
  assertNotAborted(signal);
  const first = await requestPart({ part: 0 }, signal);
  assertNotAborted(signal);
  if (first.part !== 0 || !Number.isInteger(first.totalParts) || first.totalParts < 1
    || first.format !== "my-elf-countdown-family-backup" || first.schemaVersion !== 1
    || !/^[a-f0-9]{64}$/.test(first.sha256) || Number.isNaN(Date.parse(first.exportedAt))) {
    throw new Error("The backup response was invalid. Please try again.");
  }
  const chunks = [first.chunk];
  for (let part = 1; part < first.totalParts; part++) {
    assertNotAborted(signal);
    const next = await requestPart({ part, expectedHash: first.sha256 }, signal);
    assertNotAborted(signal);
    if (next.part !== part || next.totalParts !== first.totalParts || next.sha256 !== first.sha256
      || next.format !== first.format || next.schemaVersion !== first.schemaVersion) {
      throw new Error("Your backup changed during download. Please download it again.");
    }
    chunks.push(next.chunk);
  }
  const serialized = chunks.join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  assertNotAborted(signal);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== first.sha256) throw new Error("The backup could not be verified. Please try again.");
  const document = JSON.parse(serialized);
  if (document.format !== first.format || document.schemaVersion !== first.schemaVersion || !document.content) {
    throw new Error("The backup content was invalid. Please try again.");
  }
  return { ...document, exportedAt: first.exportedAt, contentSha256: first.sha256 };
}

export function downloadFamilyBackupFile(document: Awaited<ReturnType<typeof collectFamilyBackup>>) {
  const blob = new Blob([JSON.stringify(document, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  const timestamp = document.exportedAt.replace(/[:.]/g, "-");
  link.href = url;
  link.download = `my-elf-countdown-family-backup-${timestamp}.json`;
  window.document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
