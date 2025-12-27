import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { canonicalizeUrl } from "./lib/canonical-url.ts";
import { findRecordLedgerPath } from "./lib/find-record-path.ts";

type Slot = "morning" | "noon" | "night";
type DocStatus = "not_started" | "draft" | "published" | "needs_review";
type Theme = "ipo" | "revenue" | "billionaire";
type CandidatePayload = {
  version: number;
  slot: Slot;
  dateLocal: string;
  generatedAtUTC: string;
  status: "selected" | "none";
  reason: string | null;
  candidate: Candidate | null;
};

type Candidate = {
  theme: Theme;
  title: string;
  url: string;
  canonicalUrl?: string;
  publishedAtISO: string | null;
  source: {
    id: string;
    name: string;
    weight: number;
  };
  entityGuess: {
    type: "company" | "person" | "unknown";
    name: string;
  };
  score: {
    total: number;
    sourceWeight: number;
    themeWeight: number;
    recencyScore: number;
  };
};

const SLOT_VALUES = new Set<Slot>(["morning", "noon", "night"]);
const DOC_STATUS_VALUES = new Set<DocStatus>([
  "not_started",
  "draft",
  "published",
  "needs_review"
]);
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
  if (dateLocal && !/^\d{4}-\d{2}-\d{2}$/.test(dateLocal)) {
    throw new Error("Informe --date no formato YYYY-MM-DD.");
  }
  const force = args.includes("--force");
  const supersedeIdx = args.indexOf("--supersede");
  const supersede = supersedeIdx >= 0 ? args[supersedeIdx + 1] : undefined;
  if (supersedeIdx >= 0 && !supersede) {
    throw new Error("Informe --supersede <oldRecordId>.");
  }
  const candidateIdx = args.indexOf("--candidatePath");
  const candidatePath = candidateIdx >= 0 ? args[candidateIdx + 1] : undefined;
  const recordsIdx = args.indexOf("--baseRecordsDir");
  const baseRecordsDir = recordsIdx >= 0 ? args[recordsIdx + 1] : undefined;
  const contentIdx = args.indexOf("--baseContentDir");
  const baseContentDir = contentIdx >= 0 ? args[contentIdx + 1] : undefined;
  const docsIdx = args.indexOf("--baseDocsDir");
  const baseDocsDir = docsIdx >= 0 ? args[docsIdx + 1] : undefined;
  return {
    slot,
    dateLocal,
    force,
    supersede,
    candidatePath,
    baseRecordsDir,
    baseContentDir,
    baseDocsDir
  };
}

function formatDateKey(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function normalizeTitle(title: string) {
  return title.replace(/\s+/g, " ").trim();
}

function buildRecordId(theme: Theme, canonicalUrl: string, dateLocal: string) {
  const hash = crypto
    .createHash("sha1")
    .update(`${theme}|${canonicalUrl}|${dateLocal}`)
    .digest("hex")
    .slice(0, 12);
  return `${RECORD_PREFIX[theme]}_${hash}`;
}

async function readCandidate(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as CandidatePayload;
}

function buildMarkdown(
  candidate: Candidate,
  canonicalUrl: string,
  dateLocal: string,
  recordId: string,
  supersede?: string
) {
  const title = normalizeTitle(candidate.title);
  const publishedAt = candidate.publishedAtISO;
  const ledgerNote = publishedAt
    ? `Initial ledger entry. Published at ${publishedAt}. Extended document pending.`
    : "Initial ledger entry. Extended document pending.";
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(
    `**Ledger Entry** · ${candidate.theme.toUpperCase()} · ${dateLocal} · Source: ${candidate.source.name}`
  );
  lines.push("");
  lines.push(ledgerNote);
  lines.push("");
  lines.push(`- Canonical URL: ${canonicalUrl}`);
  lines.push(`- Record ID: ${recordId}`);
  if (supersede) {
    lines.push(`- Supersedes: ${supersede}`);
  }
  return lines.join("\n");
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
    if (parsed.status && DOC_STATUS_VALUES.has(parsed.status as DocStatus)) {
      return parsed.status as DocStatus;
    }
  } catch {
    return "not_started";
  }
  return "not_started";
}

async function writeSupersededSidecar(
  oldLedgerPath: string,
  oldRecordId: string,
  newRecordId: string
) {
  const supersedePath = path.join(path.dirname(oldLedgerPath), `${oldRecordId}.superseded.json`);
  const payload = { supersededBy: newRecordId, updatedAtUTC: new Date().toISOString() };
  await fs.writeFile(supersedePath, JSON.stringify(payload, null, 2), "utf8");
  return { created: true, path: supersedePath };
}

async function main() {
  const {
    slot,
    dateLocal: dateArg,
    force,
    supersede,
    candidatePath: candidateOverride,
    baseRecordsDir,
    baseContentDir,
    baseDocsDir
  } = parseArgs();
  const rootDir = process.cwd();
  const dateLocal = dateArg ?? formatDateKey("America/Sao_Paulo");
  const candidatePath =
    candidateOverride ?? path.join(rootDir, "out", `candidate-${dateLocal}-${slot}.json`);
  const resolvedRecordsDir = baseRecordsDir
    ? path.resolve(rootDir, baseRecordsDir)
    : path.join(rootDir, "records");
  const resolvedContentDir = baseContentDir
    ? path.resolve(rootDir, baseContentDir)
    : path.join(rootDir, "content", "atlas", "records");
  const resolvedDocsDir = baseDocsDir ? path.resolve(rootDir, baseDocsDir) : path.join(rootDir, "docs");

  const payload = await readCandidate(candidatePath);
  if (payload.status !== "selected" || !payload.candidate) {
    const summary = {
      action: "publish_record",
      status: "skipped",
      reason: payload.reason ?? "no_selected_items",
      recordId: null,
      pathsCreated: [],
      warnings: []
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const candidate = payload.candidate;
  const canonicalUrl = candidate.canonicalUrl
    ? canonicalizeUrl(candidate.canonicalUrl)
    : canonicalizeUrl(candidate.url);
  const recordId = buildRecordId(candidate.theme, canonicalUrl, dateLocal);

  const dateParts = dateLocal.split("-");
  const ledgerDir = path.join(
    resolvedRecordsDir,
    dateParts[0],
    dateParts[1],
    dateParts[2]
  );
  const ledgerPath = path.join(ledgerDir, `${recordId}.json`);
  const markdownDir = resolvedContentDir;
  const markdownPath = path.join(resolvedContentDir, `${recordId}.md`);
  const docsDir = path.join(resolvedDocsDir, recordId);
  const docsStatusPath = path.join(docsDir, "status.json");
  const docsSourcesPath = path.join(docsDir, "sources.json");

  const ledgerExists = await fileExists(ledgerPath);
  const pathsCreated: string[] = [];
  const warnings: string[] = [];
  let supersedeInfo:
    | {
        requested: string;
        found: boolean;
        targetPath?: string;
        sidecarPath?: string;
        warnings?: string[];
      }
    | null = null;

  if (ledgerExists && !force) {
    const summary = {
      action: "publish_record",
      status: "already_exists",
      recordId,
      pathsCreated,
      warnings
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  await ensureDir(ledgerDir);
  await ensureDir(markdownDir);
  await ensureDir(docsDir);

  const generatedAtUTC = new Date().toISOString();
  const docStatus = await readDocStatus(docsStatusPath);
  const ledger = {
    version: 1,
    recordId,
    dateLocal,
    slot,
    theme: candidate.theme,
    title: normalizeTitle(candidate.title),
    canonicalUrl,
    publishedAtISO: candidate.publishedAtISO,
    source: {
      id: candidate.source.id,
      name: candidate.source.name,
      weight: candidate.source.weight
    },
    entityGuess: candidate.entityGuess,
    score: candidate.score,
    pipeline: {
      pipelineVersion: 1,
      candidatePath: path.relative(rootDir, candidatePath),
      generatedAtUTC: payload.generatedAtUTC ?? generatedAtUTC
    },
    statuses: {
      recordStatus: "recorded",
      docStatus
    }
  };

  if (supersede) {
    (ledger as { supersedes?: string }).supersedes = supersede;
  }

  await fs.writeFile(ledgerPath, JSON.stringify(ledger, null, 2), "utf8");
  pathsCreated.push(path.relative(rootDir, ledgerPath));

  if (force || !(await fileExists(markdownPath))) {
    const markdown = buildMarkdown(candidate, canonicalUrl, dateLocal, recordId, supersede);
    await fs.writeFile(markdownPath, markdown, "utf8");
    pathsCreated.push(path.relative(rootDir, markdownPath));
  }

  if (!(await fileExists(docsStatusPath))) {
    await fs.writeFile(
      docsStatusPath,
      JSON.stringify({ status: "not_started", updatedAtUTC: generatedAtUTC }, null, 2),
      "utf8"
    );
    pathsCreated.push(path.relative(rootDir, docsStatusPath));
  }

  if (!(await fileExists(docsSourcesPath))) {
    await fs.writeFile(docsSourcesPath, JSON.stringify([], null, 2), "utf8");
    pathsCreated.push(path.relative(rootDir, docsSourcesPath));
  }

  if (supersede) {
    const found = await findRecordLedgerPath(resolvedRecordsDir, supersede);
    supersedeInfo = {
      requested: supersede,
      found: found.found,
      targetPath: found.path ? path.relative(rootDir, found.path) : undefined,
      warnings: found.warnings
    };
    if (!found.found) {
      warnings.push("supersede_target_not_found");
    } else if (found.warnings?.length) {
      warnings.push(...found.warnings);
    }
    if (found.found && found.path) {
      const sidecar = await writeSupersededSidecar(found.path, supersede, recordId);
      pathsCreated.push(path.relative(rootDir, sidecar.path));
      supersedeInfo.sidecarPath = path.relative(rootDir, sidecar.path);
    }
  }

  const summary = {
    action: "publish_record",
    status: "created",
    recordId,
    pathsCreated,
    warnings,
    supersede: supersedeInfo
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`[publish-record] Falha: ${(error as Error).message}`);
  process.exitCode = 1;
});
