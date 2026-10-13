import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MemoryStore } from "./memory.js";

/**
 * File-backed store for local development: same semantics as MemoryStore,
 * persisted to a JSON file so data survives API restarts.
 */
export class FileStore extends MemoryStore {
  private readonly filePath: string;
  private saveScheduled = false;

  constructor(filePath: string) {
    super();
    this.filePath = filePath;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const raw = readFileSync(this.filePath, "utf8");
      if (!raw.trim()) return;
      const data = JSON.parse(raw) as Record<string, unknown[]>;
      this.load(data);
    } catch {
      // Corrupt/empty file: start fresh rather than crash local dev.
    }
  }

  protected override afterCommit(): void {
    if (this.inTransaction || this.saveScheduled) return;
    this.saveScheduled = true;
    // Defer to the next microtask so bursts of writes coalesce into one flush.
    void Promise.resolve().then(() => {
      this.saveScheduled = false;
      try {
        mkdirSync(dirname(this.filePath), { recursive: true });
        writeFileSync(this.filePath, JSON.stringify(this.dump()));
      } catch {
        // Local persistence must never break the API.
      }
    });
  }

  /** Test helper: flush pending writes synchronously. */
  flush(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.dump()));
    } catch {
      // ignore
    }
  }
}
