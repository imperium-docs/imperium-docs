import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { canonicalizeUrl } from "./lib/canonical-url.ts";
import { findRecordLedgerPath } from "./lib/find-record-path.ts";

type Slot = "morning" | "noon" | "night";
type Theme = "ipo" | "revenue" | "billionaire";

type CandidatePayload = {
  status: "selected" | "none";
  reason: string | null;
  dateLocal: string;
  generatedAtUTC: string;
  candidate: {
    theme: Theme;
    url: string;
    canonicalUrl?: string;
  } | null;
};

const SLOT_VALUES = new Set<Slot>(["morning", "noon", "night"]);
const RECORD_PREFIX: Record<Theme, string> = {
  ipo: "ipo",
  revenue: "rev",
  billionaire: "bil"
};

function parseArgs() {
  const args = process.argv.slice(2);
  const oldIdx = args.indexOf("--oldRecordId");
  const oldRecordId = oldIdx >= 0 ? args[oldIdx + 1] : undefined;
  if (!oldRecordId) {
    throw new Error("Informe --oldRecordId.");
  }
  const slotIdx = args.indexOf("--slot");
  const slot = slotIdx >= 0 ? (args[slotIdx + 1] as Slot | undefined) : "morning";
  if (!slot || !SLOT_VALUES.has(slot)) {
    throw new Error("Informe --slot morning|noon|night.");
  }
  const dateOldIdx = args.indexOf("--dateOld");
  const dateOld = dateOldIdx >= 0 ? args[dateOldIdx + 1] : undefined;
  if (!dateOld || !/^\d{4}-\d{2}-\d{2}$/.test(dateOld)) {
    throw new Error("Informe --dateOld no formato YYYY-MM-DD.");
  }
  const dateNewIdx = args.indexOf("--dateNew");
  const dateNew = dateNewIdx >= 0 ? args[dateNewIdx + 1] : undefined;
  if (!dateNew || !/^\d{4}-\d{2}-\d{2}$/.test(dateNew)) {
    throw new Error("Informe --dateNew no formato YYYY-MM-DD.");
  }
  const candidateIdx = args.indexOf("--candidatePath");
  const candidatePath = candidateIdx >= 0 ? args[candidateIdx + 1] : undefined;
  return { oldRecordId, slot, dateOld, dateNew, candidatePath };
}

function buildRecordId(theme: Theme, canonicalUrl: string, dateLocal: string) {
  const hash = crypto
    .createHash("sha1")
    .update(`${theme}|${canonicalUrl}|${dateLocal}`)
    .digest("hex")
    .slice(0, 12);
  return `${RECORD_PREFIX[theme]}_${hash}`;
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

async function sha256(filePath: string) {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function runPublish(scriptPath: string, args: string[]) {
  return new Promise<{ code: number }>((resolve, reject) => {
    const child = spawn(process.execPath, ["-r", "ts-node/register", scriptPath, ...args], {
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1 }));
  });
}

async function main() {
  const { oldRecordId, slot, dateOld, dateNew, candidatePath } = parseArgs();
  const rootDir = process.cwd();
  const errors: string[] = [];

  const fixturesRoot = path.join(rootDir, "fixtures");
  const fixturesOut = path.join(fixturesRoot, "out");
  const fixturesRecords = path.join(fixturesRoot, "records");
  const fixturesContent = path.join(fixturesRoot, "content", "atlas", "records");
  const fixturesDocs = path.join(fixturesRoot, "docs");

  await ensureDir(fixturesOut);
  await ensureDir(fixturesRecords);
  await ensureDir(fixturesContent);
  await ensureDir(fixturesDocs);

  const sourceCandidatePath =
    candidatePath ?? path.join(rootDir, "out", `candidate-${dateOld}-${slot}.json`);
  if (!(await fileExists(sourceCandidatePath))) {
    errors.push("source_candidate_missing");
  }

  if (errors.length) {
    const summary = { ok: false, oldRecordId, errors };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const candidateRaw = await fs.readFile(sourceCandidatePath, "utf8");
  const candidatePayload = JSON.parse(candidateRaw) as CandidatePayload;
  if (candidatePayload.status !== "selected" || !candidatePayload.candidate) {
    errors.push("candidate_not_selected");
  }

  const fixtureCandidatePath = path.join(fixturesOut, `candidate-${dateNew}-${slot}.json`);
  if (candidatePayload) {
    const updated = {
      ...candidatePayload,
      dateLocal: dateNew,
      generatedAtUTC: new Date().toISOString()
    };
    await fs.writeFile(fixtureCandidatePath, JSON.stringify(updated, null, 2), "utf8");
  }

  const productionRecordsRoot = path.join(rootDir, "records");
  const oldLedgerFound = await findRecordLedgerPath(productionRecordsRoot, oldRecordId);
  if (!oldLedgerFound.found || !oldLedgerFound.path) {
    errors.push("old_ledger_not_found");
  }

  let oldLedgerFixturePath: string | null = null;
  let oldMarkdownFixturePath: string | null = null;
  let oldLedgerHashBefore: string | null = null;
  let oldMarkdownHashBefore: string | null = null;
  if (oldLedgerFound.path) {
    const relativeOldLedger = path.relative(productionRecordsRoot, oldLedgerFound.path);
    oldLedgerFixturePath = path.join(fixturesRecords, relativeOldLedger);
    await ensureDir(path.dirname(oldLedgerFixturePath));
    await fs.copyFile(oldLedgerFound.path, oldLedgerFixturePath);

    const prodMarkdownPath = path.join(rootDir, "content", "atlas", "records", `${oldRecordId}.md`);
    if (await fileExists(prodMarkdownPath)) {
      oldMarkdownFixturePath = path.join(fixturesContent, `${oldRecordId}.md`);
      await fs.copyFile(prodMarkdownPath, oldMarkdownFixturePath);
    } else {
      errors.push("old_markdown_missing");
    }
  }

  if (oldLedgerFixturePath && (await fileExists(oldLedgerFixturePath))) {
    oldLedgerHashBefore = await sha256(oldLedgerFixturePath);
  }
  if (oldMarkdownFixturePath && (await fileExists(oldMarkdownFixturePath))) {
    oldMarkdownHashBefore = await sha256(oldMarkdownFixturePath);
  }

  if (errors.length) {
    const summary = {
      ok: false,
      oldRecordId,
      errors
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const publishScript = path.join(rootDir, "scripts", "publish-record.ts");
  const publishArgs = [
    "--slot",
    slot,
    "--date",
    dateNew,
    "--candidatePath",
    fixtureCandidatePath,
    "--baseRecordsDir",
    path.relative(rootDir, fixturesRecords),
    "--baseContentDir",
    path.relative(rootDir, fixturesContent),
    "--baseDocsDir",
    path.relative(rootDir, fixturesDocs),
    "--supersede",
    oldRecordId
  ];

  const publishResult = await runPublish(publishScript, publishArgs);
  if (publishResult.code !== 0) {
    errors.push("publish_failed");
  }

  const candidateData = JSON.parse(
    await fs.readFile(fixtureCandidatePath, "utf8")
  ) as CandidatePayload;
  const candidate = candidateData.candidate;
  let newRecordId: string | null = null;
  if (candidate) {
    const canonicalUrl = candidate.canonicalUrl
      ? canonicalizeUrl(candidate.canonicalUrl)
      : canonicalizeUrl(candidate.url);
    newRecordId = buildRecordId(candidate.theme, canonicalUrl, dateNew);
  } else {
    errors.push("fixture_candidate_missing");
  }

  const dateParts = dateNew.split("-");
  const newLedgerPath = newRecordId
    ? path.join(fixturesRecords, dateParts[0], dateParts[1], dateParts[2], `${newRecordId}.json`)
    : null;
  const newMarkdownPath = newRecordId
    ? path.join(fixturesContent, `${newRecordId}.md`)
    : null;
  const newDocsStatusPath = newRecordId ? path.join(fixturesDocs, newRecordId, "status.json") : null;
  const newDocsSourcesPath = newRecordId ? path.join(fixturesDocs, newRecordId, "sources.json") : null;

  const sidecarPath =
    oldLedgerFixturePath && oldRecordId
      ? path.join(path.dirname(oldLedgerFixturePath), `${oldRecordId}.superseded.json`)
      : null;

  const assertions: Record<string, boolean> = {};
  if (newLedgerPath) assertions.newLedgerExists = await fileExists(newLedgerPath);
  if (newMarkdownPath) assertions.newMarkdownExists = await fileExists(newMarkdownPath);
  if (newDocsStatusPath) assertions.newDocsStatusExists = await fileExists(newDocsStatusPath);
  if (newDocsSourcesPath) assertions.newDocsSourcesExists = await fileExists(newDocsSourcesPath);
  if (sidecarPath) assertions.sidecarExists = await fileExists(sidecarPath);

  if (newLedgerPath && (await fileExists(newLedgerPath))) {
    const newLedgerRaw = await fs.readFile(newLedgerPath, "utf8");
    const newLedger = JSON.parse(newLedgerRaw) as { supersedes?: string };
    assertions.newLedgerHasSupersedes = newLedger.supersedes === oldRecordId;
  }

  if (oldLedgerFixturePath && oldLedgerHashBefore) {
    const oldLedgerHashAfter = await sha256(oldLedgerFixturePath);
    assertions.oldLedgerUnchanged = oldLedgerHashBefore === oldLedgerHashAfter;
  }
  if (oldMarkdownFixturePath && oldMarkdownHashBefore) {
    const oldMarkdownHashAfter = await sha256(oldMarkdownFixturePath);
    assertions.oldMarkdownUnchanged = oldMarkdownHashBefore === oldMarkdownHashAfter;
  }

  for (const [key, value] of Object.entries(assertions)) {
    if (!value) errors.push(`assertion_failed:${key}`);
  }

  const summary = {
    ok: errors.length === 0,
    oldRecordId,
    newRecordId,
    paths: {
      fixtureCandidate: fixtureCandidatePath,
      oldLedger: oldLedgerFixturePath,
      oldMarkdown: oldMarkdownFixturePath,
      newLedger: newLedgerPath,
      newMarkdown: newMarkdownPath,
      sidecar: sidecarPath,
      newDocsStatus: newDocsStatusPath,
      newDocsSources: newDocsSourcesPath
    },
    assertions,
    errors
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[fixture-supersede-test] Falha: ${(error as Error).message}`);
  process.exitCode = 1;
});
