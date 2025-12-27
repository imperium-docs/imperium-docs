import fs from "node:fs/promises";
import path from "node:path";
import { findRecordLedgerPath } from "./lib/find-record-path.ts";

type DocStatus = "not_started" | "draft" | "published" | "needs_review";

function parseArgs() {
  const args = process.argv.slice(2);
  const recordIdx = args.indexOf("--recordId");
  const recordId = recordIdx >= 0 ? args[recordIdx + 1] : undefined;
  if (!recordId) {
    throw new Error("Informe --recordId.");
  }
  return { recordId };
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readDocStatus(filePath: string): Promise<DocStatus> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { status?: string };
    if (
      parsed.status === "not_started" ||
      parsed.status === "draft" ||
      parsed.status === "published" ||
      parsed.status === "needs_review"
    ) {
      return parsed.status;
    }
  } catch {
    return "not_started";
  }
  return "not_started";
}

function buildStubContent() {
  const lines: string[] = [];
  lines.push("# Document Draft");
  lines.push("");
  lines.push("## Opening Phenomenon");
  lines.push("This entry is an initial trace within the ledger.");
  lines.push("This record stands without narrative until sources are attached.");
  lines.push("");
  lines.push("## Historical Positioning");
  lines.push("This record is placed within an archival sequence.");
  lines.push("This entry holds its position pending evidence.");
  lines.push("");
  lines.push("## Mechanism of Power");
  lines.push("This record maintains a formal boundary of meaning.");
  lines.push("This entry defers analysis until sources exist.");
  lines.push("");
  lines.push("## Agents Involved");
  lines.push("This record does not assign agents without sources.");
  lines.push("This entry reserves attribution for verified inputs.");
  lines.push("");
  lines.push("## Structural Question");
  lines.push("This record awaits a question that the archive can sustain.");
  lines.push("Which structure will this entry define once sources are attached?");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const { recordId } = parseArgs();
  const rootDir = process.cwd();
  const recordsRoot = path.join(rootDir, "records");

  const found = await findRecordLedgerPath(recordsRoot, recordId);
  if (!found.found || !found.path) {
    const summary = {
      ok: false,
      status: "not_found",
      recordId,
      paths: {},
      errors: ["record_not_found"]
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const docsDir = path.join(rootDir, "docs", recordId);
  const statusPath = path.join(docsDir, "status.json");
  const sourcesPath = path.join(docsDir, "sources.json");
  const stubPath = path.join(docsDir, "v1.mdx");

  await ensureDir(docsDir);
  const generatedAtUTC = new Date().toISOString();
  const pathsCreated: string[] = [];
  const warnings: string[] = [];

  if (!(await fileExists(statusPath))) {
    await fs.writeFile(
      statusPath,
      JSON.stringify({ status: "not_started", updatedAtUTC: generatedAtUTC }, null, 2),
      "utf8"
    );
    pathsCreated.push(path.relative(rootDir, statusPath));
  }

  if (!(await fileExists(sourcesPath))) {
    await fs.writeFile(sourcesPath, JSON.stringify([], null, 2), "utf8");
    pathsCreated.push(path.relative(rootDir, sourcesPath));
  }

  if (!(await fileExists(stubPath))) {
    await fs.writeFile(stubPath, buildStubContent(), "utf8");
    pathsCreated.push(path.relative(rootDir, stubPath));
  }

  const docStatus = await readDocStatus(statusPath);
  const summary = {
    ok: true,
    status: "stub_ready",
    recordId,
    docStatus,
    paths: {
      ledger: path.relative(rootDir, found.path),
      docsDir: path.relative(rootDir, docsDir),
      status: path.relative(rootDir, statusPath),
      sources: path.relative(rootDir, sourcesPath),
      stub: path.relative(rootDir, stubPath)
    },
    pathsCreated,
    warnings
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`[build-doc-stub] Falha: ${(error as Error).message}`);
  process.exitCode = 1;
});
