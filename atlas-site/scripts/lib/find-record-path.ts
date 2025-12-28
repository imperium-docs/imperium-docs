import fs from "node:fs/promises";
import path from "node:path";

export async function findRecordLedgerPath(recordsDir: string, recordId: string): Promise<{ found: boolean; path?: string; warnings?: string[] }> {
  async function walk(dir: string): Promise<string | null> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const result = await walk(entryPath);
        if (result) return result;
      } else if (entry.isFile() && entry.name === `${recordId}.json`) {
        return entryPath;
      }
    }
    return null;
  }

  try {
    const foundPath = await walk(recordsDir);
    if (foundPath) {
      return { found: true, path: foundPath, warnings: [] };
    }
    return { found: false, warnings: [] };
  } catch (error) {
    return { found: false, warnings: [(error as Error).message] };
  }
}
