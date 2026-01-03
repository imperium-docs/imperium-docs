import fs from "node:fs/promises";
import path from "node:path";

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

async function main() {
  const rootDir = process.cwd();
  const feedPath = path.join(rootDir, "feed.json");
  const raw = await fs.readFile(feedPath, "utf8");
  const payload = JSON.parse(raw) as { version?: number; generated_at?: string; items?: unknown[] };
  const errors: string[] = [];

  if (payload.version !== 4) errors.push("feed_version_not_v4");
  if (!isNonEmptyString(payload.generated_at)) errors.push("missing_generated_at");
  if (!Array.isArray(payload.items)) errors.push("items_not_array");

  const summary = {
    ok: errors.length === 0,
    errors,
    feedPath: path.relative(rootDir, feedPath)
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[verify-pipeline] Falha: ${(error as Error).message}`);
  process.exitCode = 1;
});
