import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { canonicalizeUrl } from "./lib/canonical-url.ts";

type Slot = "morning" | "noon" | "night";
type Theme = "ipo" | "revenue" | "billionaire";

type CandidatePayload = {
  status: "selected" | "none";
  reason: string | null;
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
  const slotIdx = args.indexOf("--slot");
  const slot = slotIdx >= 0 ? (args[slotIdx + 1] as Slot | undefined) : undefined;
  if (!slot || !SLOT_VALUES.has(slot)) {
    throw new Error("Informe --slot morning|noon|night.");
  }
  const dateIdx = args.indexOf("--date");
  const dateLocal = dateIdx >= 0 ? args[dateIdx + 1] : undefined;
  if (!dateLocal || !/^\d{4}-\d{2}-\d{2}$/.test(dateLocal)) {
    throw new Error("Informe --date no formato YYYY-MM-DD.");
  }
  return { slot, dateLocal };
}

function buildRecordId(theme: Theme, canonicalUrl: string, dateLocal: string) {
  const hash = crypto
    .createHash("sha1")
    .update(`${theme}|${canonicalUrl}|${dateLocal}`)
    .digest("hex")
    .slice(0, 12);
  return `${RECORD_PREFIX[theme]}_${hash}`;
}

async function runScript(scriptPath: string, args: string[]) {
  return new Promise<{ code: number }>((resolve, reject) => {
    const child = spawn(process.execPath, ["-r", "ts-node/register", scriptPath, ...args], {
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1 }));
  });
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { slot, dateLocal } = parseArgs();
  const rootDir = process.cwd();
  const errors: string[] = [];

  const selectPath = path.join(rootDir, "scripts", "select-candidate.ts");
  const publishPath = path.join(rootDir, "scripts", "publish-record.ts");

  const selectResult = await runScript(selectPath, ["--slot", slot, "--date", dateLocal]);
  if (selectResult.code !== 0) {
    errors.push("select_candidate_failed");
  }

  const publishResult = await runScript(publishPath, ["--slot", slot, "--date", dateLocal]);
  if (publishResult.code !== 0) {
    errors.push("publish_record_failed");
  }

  const candidatePath = path.join(rootDir, "out", `candidate-${dateLocal}-${slot}.json`);
  const candidateExists = await fileExists(candidatePath);
  if (!candidateExists) {
    errors.push("candidate_missing");
  }

  let recordId: string | null = null;
  let ledgerPath: string | null = null;
  let markdownPath: string | null = null;
  let docsStatusPath: string | null = null;
  let docsSourcesPath: string | null = null;

  if (candidateExists) {
    const raw = await fs.readFile(candidatePath, "utf8");
    const payload = JSON.parse(raw) as CandidatePayload;
    if (payload.status === "selected" && payload.candidate) {
      const canonicalUrl = payload.candidate.canonicalUrl
        ? canonicalizeUrl(payload.candidate.canonicalUrl)
        : canonicalizeUrl(payload.candidate.url);
      recordId = buildRecordId(payload.candidate.theme, canonicalUrl, dateLocal);
      const dateParts = dateLocal.split("-");
      ledgerPath = path.join(
        rootDir,
        "records",
        dateParts[0],
        dateParts[1],
        dateParts[2],
        `${recordId}.json`
      );
      markdownPath = path.join(rootDir, "content", "atlas", "records", `${recordId}.md`);
      docsStatusPath = path.join(rootDir, "docs", recordId, "status.json");
      docsSourcesPath = path.join(rootDir, "docs", recordId, "sources.json");

      if (!(await fileExists(ledgerPath))) errors.push("ledger_missing");
      if (!(await fileExists(markdownPath))) errors.push("markdown_missing");
      if (!(await fileExists(docsStatusPath))) errors.push("docs_status_missing");
      if (!(await fileExists(docsSourcesPath))) errors.push("docs_sources_missing");
    } else {
      errors.push("candidate_not_selected");
    }
  }

  const summary = {
    ok: errors.length === 0,
    slot,
    date: dateLocal,
    recordId,
    paths: {
      candidate: candidatePath,
      ledger: ledgerPath,
      markdown: markdownPath,
      docsStatus: docsStatusPath,
      docsSources: docsSourcesPath
    },
    errors
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[verify-pipeline] Falha: ${(error as Error).message}`);
  process.exitCode = 1;
});
