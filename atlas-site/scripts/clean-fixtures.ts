import fs from "node:fs/promises";
import path from "node:path";

const TARGETS = ["out", "records", "content", "docs"];

async function removeContents(dirPath: string) {
  try {
    const entries = await fs.readdir(dirPath);
    await Promise.all(
      entries.map((entry) =>
        fs.rm(path.join(dirPath, entry), { recursive: true, force: true })
      )
    );
  } catch {
    return;
  }
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function main() {
  const rootDir = process.cwd();
  const fixturesRoot = path.join(rootDir, "fixtures");
  const pathsCleaned: string[] = [];

  for (const target of TARGETS) {
    const dirPath = path.join(fixturesRoot, target);
    await removeContents(dirPath);
    await ensureDir(dirPath);
    pathsCleaned.push(path.relative(rootDir, dirPath));
  }

  const summary = { ok: true, pathsCleaned };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`[clean-fixtures] Falha: ${(error as Error).message}`);
  process.exitCode = 1;
});
