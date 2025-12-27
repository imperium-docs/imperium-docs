import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { XMLParser } from "fast-xml-parser";
import { canonicalizeUrl } from "./lib/canonical-url.ts";

type Slot = "morning" | "noon" | "night";
type Theme = "ipo" | "revenue" | "billionaire";
type DocStatus = "not_started" | "draft" | "published" | "needs_review";

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

type CandidatePayload = {
  version: number;
  slot: Slot;
  dateLocal: string;
  generatedAtUTC: string;
  status: "selected" | "none";
  reason: string | null;
  candidate: Candidate | null;
};

const SLOT_SEQUENCE: Slot[] = ["morning", "noon", "night"];
const THEME_SEQUENCE: Theme[] = ["ipo", "revenue", "billionaire"];
const TIME_ZONE = "America/Sao_Paulo";
const SEC_RSS_URL = "https://www.sec.gov/news/pressreleases.rss";
const SEC_FALLBACK_URL = "https://www.sec.gov/news/pressreleases";
const USER_AGENT = "imperium-atlas/1.0 (autopublish)";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true
});

function parseArgs() {
  const args = process.argv.slice(2);
  const slotIdx = args.indexOf("--slot");
  const slot = slotIdx >= 0 ? (args[slotIdx + 1] as Slot | undefined) : undefined;
  if (slot && !SLOT_SEQUENCE.includes(slot)) {
    throw new Error("Informe --slot morning|noon|night.");
  }
  const dateIdx = args.indexOf("--date");
  const dateLocal = dateIdx >= 0 ? args[dateIdx + 1] : undefined;
  if (dateLocal && !/^\d{4}-\d{2}-\d{2}$/.test(dateLocal)) {
    throw new Error("Informe --date no formato YYYY-MM-DD.");
  }
  return { slot, dateLocal };
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

function resolveSlot(slotArg: Slot | undefined) {
  if (slotArg) return slotArg;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const hourPart = parts.find((part) => part.type === "hour")?.value ?? "0";
  const hour = Number(hourPart);
  if (hour >= 0 && hour < 10) return "morning";
  if (hour >= 10 && hour < 16) return "noon";
  return "night";
}

function nextSlot(slot: Slot) {
  const idx = SLOT_SEQUENCE.indexOf(slot);
  return SLOT_SEQUENCE[(idx + 1) % SLOT_SEQUENCE.length];
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function recencyScore(publishedAtISO: string | null) {
  if (!publishedAtISO) return 0.9;
  const parsed = new Date(publishedAtISO);
  if (Number.isNaN(parsed.getTime())) return 0.9;
  const hoursSince = (Date.now() - parsed.getTime()) / 36e5;
  return clamp(1.6 - hoursSince / 72, 0.6, 1.6);
}

function entityGuessFromTitle(title: string) {
  const raw = normalizeText(title);
  let simplified = raw.replace(/^\d+\s+\w+\s+to\s+/i, "");
  simplified = simplified.replace(/^how to\s+/i, "");
  simplified = simplified.replace(/^\d+\s+/, "");
  const splitMatch = simplified.split(/\s*[:\\-]\s*/);
  const name = normalizeText(splitMatch[0] || raw);
  const lower = raw.toLowerCase();
  const isCompany =
    lower.includes("announces") ||
    lower.includes("reports") ||
    lower.includes("offering") ||
    lower.includes("results") ||
    lower.includes("ipo");
  const isPerson =
    lower.includes("billionaire") ||
    lower.includes("net worth") ||
    /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(raw);
  const type = isCompany ? "company" : isPerson ? "person" : "unknown";
  return { type, name };
}

const REJECT_PATTERNS = [
  /stocks to buy/i,
  /reasons to buy/i,
  /is\s+.+\s+a\s+buy/i,
  /top\s+\d+/i,
  /list of/i,
  /down\s+\d+%/i,
  /pops are back/i
];

function isAgentBearing(candidate: Candidate) {
  const title = candidate.title ?? "";
  if (REJECT_PATTERNS.some((pattern) => pattern.test(title))) {
    return false;
  }
  return candidate.entityGuess.type !== "unknown";
}

async function runNodeScript(args: string[]) {
  const nodeBin = process.execPath;
  const commandArgs = ["-r", "ts-node/register", ...args];
  const proc = spawn(nodeBin, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  proc.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  proc.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
  const exitCode = await new Promise<number>((resolve) => {
    proc.on("close", (code) => resolve(code ?? 0));
  });
  return {
    exitCode,
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8")
  };
}

function parseJsonOutput(text: string) {
  const lines = text.trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        return JSON.parse(line) as any;
      } catch {
        continue;
      }
    }
  }
  try {
    return JSON.parse(text) as any;
  } catch {
    return null;
  }
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

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const text = (value as any)["#text"];
    if (typeof text === "string") return text.trim();
  }
  return null;
}

function pickLink(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const entry of value) {
      const link = pickLink(entry);
      if (link) return link;
    }
    return null;
  }
  if (typeof value === "object") {
    const href = (value as any)["@_href"];
    if (typeof href === "string") return href.trim();
    const text = (value as any)["#text"];
    if (typeof text === "string") return text.trim();
  }
  return null;
}

function normalizePublishedAt(raw: string | null | undefined) {
  if (!raw) return { publishedAtISO: null };
  const trimmed = raw.trim();
  if (!trimmed) return { publishedAtISO: null };
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return { publishedAtISO: null };
  }
  return { publishedAtISO: date.toISOString() };
}

async function fetchSecPressReleases(limit: number) {
  try {
    const response = await fetch(SEC_RSS_URL, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1"
      }
    });
    if (!response.ok) {
      throw new Error(`SEC RSS HTTP ${response.status}`);
    }
    const xml = await response.text();
    const feed = parser.parse(xml);
    const channel = feed?.rss?.channel ?? feed?.channel;
    if (channel) {
      const items = toArray(channel.item).slice(0, limit);
      return items.map((item) => {
        const title = textValue(item.title);
        const url = pickLink(item.link ?? item.guid);
        const publishedAt = textValue(item.pubDate ?? item["dc:date"]);
        return {
          title: title ?? "SEC Press Release",
          url: url ?? SEC_FALLBACK_URL,
          publishedAtISO: normalizePublishedAt(publishedAt).publishedAtISO
        };
      });
    }
    const atom = feed?.feed;
    if (atom) {
      const entries = toArray(atom.entry).slice(0, limit);
      return entries.map((entry) => {
        const title = textValue(entry.title);
        const url = pickLink(entry.link);
        const publishedAt = textValue(entry.updated ?? entry.published);
        return {
          title: title ?? "SEC Press Release",
          url: url ?? SEC_FALLBACK_URL,
          publishedAtISO: normalizePublishedAt(publishedAt).publishedAtISO
        };
      });
    }
  } catch {
    // fall through to default fallback
  }
  return [
    {
      title: "SEC Press Release",
      url: SEC_FALLBACK_URL,
      publishedAtISO: new Date().toISOString()
    }
  ];
}

async function writeFallbackCandidate(
  rootDir: string,
  slot: Slot,
  dateLocal: string,
  secItem: { title: string; url: string; publishedAtISO: string | null },
  index: number
) {
  const canonicalUrl = canonicalizeUrl(secItem.url);
  const entityGuess = entityGuessFromTitle(secItem.title);
  const theme: Theme = "revenue";
  const sourceWeight = 3.0;
  const themeWeight = 1.05;
  const recency = recencyScore(secItem.publishedAtISO);
  const candidate: Candidate = {
    theme,
    title: normalizeText(secItem.title),
    url: secItem.url,
    canonicalUrl,
    publishedAtISO: secItem.publishedAtISO,
    source: {
      id: "sec_press_releases",
      name: "SEC - Press Releases",
      weight: sourceWeight
    },
    entityGuess,
    score: {
      total: sourceWeight * themeWeight * recency,
      sourceWeight,
      themeWeight,
      recencyScore: recency
    }
  };

  const payload: CandidatePayload = {
    version: 1,
    slot,
    dateLocal,
    generatedAtUTC: new Date().toISOString(),
    status: "selected",
    reason: "fallback_sec_press_release",
    candidate
  };

  const outDir = path.join(rootDir, "out");
  await fs.mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, `candidate-fallback-${dateLocal}-${slot}-${index}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return { filePath, payload };
}

async function publishCandidate(
  rootDir: string,
  slot: Slot,
  dateLocal: string,
  candidatePath: string
) {
  const scriptPath = path.join("scripts", "publish-record.ts");
  const result = await runNodeScript([
    scriptPath,
    "--slot",
    slot,
    "--date",
    dateLocal,
    "--candidatePath",
    candidatePath
  ]);
  const output = parseJsonOutput(result.stdout);
  return { result, output };
}

async function buildDocumentB(recordId: string) {
  const scriptPath = path.join("scripts", "build-document-b.ts");
  return runNodeScript([scriptPath, "--recordId", recordId]);
}

async function trySecFallbackPublish(
  rootDir: string,
  slot: Slot,
  dateLocal: string,
  limit: number
) {
  const items = await fetchSecPressReleases(limit);
  const bounded = items.slice(0, limit);
  let tried = 0;
  for (let i = 0; i < bounded.length; i += 1) {
    const secItem = bounded[i];
    tried += 1;
    const fallback = await writeFallbackCandidate(rootDir, slot, dateLocal, secItem, i);
    const publishResult = await publishCandidate(rootDir, slot, dateLocal, fallback.filePath);
    const status = publishResult.output?.status ?? "unknown";
    if (status === "created") {
      return {
        status: "posted",
        recordId: publishResult.output.recordId as string,
        candidate: fallback.payload.candidate,
        secItemIndex: i,
        secItemsTried: tried
      } as const;
    }
    if (status === "already_exists") {
      continue;
    }
    return {
      status: "failed",
      reason: status,
      secItemsTried: tried
    } as const;
  }
  return {
    status: "failed",
    reason: "sec_fallback_exhausted",
    secItemsTried: tried
  } as const;
}

async function updateFeed(params: {
  rootDir: string;
  recordId: string;
  dateLocal: string;
  slot: Slot;
  theme: Theme;
  title: string;
  canonicalUrl: string;
  docStatus: DocStatus;
}) {
  const feedPath = path.join(params.rootDir, "content", "atlas", "feed.json");
  await fs.mkdir(path.dirname(feedPath), { recursive: true });
  let payload: any = [];
  if (await fileExists(feedPath)) {
    const raw = await fs.readFile(feedPath, "utf8");
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = [];
    }
  }
  let items: any[] = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
  if (items.some((item) => item?.recordId === params.recordId)) {
    return false;
  }
  const entry = {
    recordId: params.recordId,
    dateLocal: params.dateLocal,
    slot: params.slot,
    theme: params.theme,
    title: params.title,
    canonicalUrl: params.canonicalUrl,
    recordCardPath: `content/atlas/records/${params.recordId}.md`,
    docStatus: params.docStatus
  };
  items = [...items, entry];
  const nextPayload = Array.isArray(payload) ? items : { ...(payload ?? {}), items };
  await fs.writeFile(feedPath, JSON.stringify(nextPayload, null, 2), "utf8");
  return true;
}

async function attemptSlot(slot: Slot, dateLocal: string) {
  const rootDir = process.cwd();
  let secItemsTried = 0;
  for (const theme of THEME_SEQUENCE) {
    await runNodeScript([
      path.join("scripts", "scan-headlines.ts"),
      "--slot",
      slot,
      "--theme",
      theme,
      "--limit",
      "20"
    ]);
  }

  let candidatePath = path.join(rootDir, "out", `candidate-${dateLocal}-${slot}.json`);
  const selectResult = await runNodeScript([
    path.join("scripts", "select-candidate.ts"),
    "--slot",
    slot,
    "--date",
    dateLocal
  ]);
  const selectOutput = parseJsonOutput(selectResult.stdout);
  let candidate: Candidate | null = selectOutput?.candidate ?? null;
  if (
    selectResult.exitCode !== 0 ||
    !selectOutput ||
    selectOutput.status !== "selected" ||
    !candidate ||
    !isAgentBearing(candidate)
  ) {
    const fallbackResult = await trySecFallbackPublish(rootDir, slot, dateLocal, 10);
    secItemsTried += fallbackResult.secItemsTried;
    if (fallbackResult.status === "posted") {
      candidate = fallbackResult.candidate;
      const recordId = fallbackResult.recordId;
      await buildDocumentB(recordId);
      const docsStatusPath = path.join(rootDir, "docs", recordId, "status.json");
      let docStatus = await readDocStatus(docsStatusPath);
      if (docStatus === "not_started") {
        docStatus = "needs_review";
      }

      const feedUpdated = await updateFeed({
        rootDir,
        recordId,
        dateLocal,
        slot,
        theme: candidate.theme,
        title: candidate.title,
        canonicalUrl: candidate.canonicalUrl
          ? canonicalizeUrl(candidate.canonicalUrl)
          : canonicalizeUrl(candidate.url),
        docStatus
      });

      return {
        status: "posted",
        recordId,
        theme: candidate.theme,
        title: candidate.title,
        canonicalUrl: candidate.canonicalUrl
          ? canonicalizeUrl(candidate.canonicalUrl)
          : canonicalizeUrl(candidate.url),
        docStatus,
        feedUpdated,
        secItemIndex: fallbackResult.secItemIndex,
        secItemsTried
      } as const;
    }
    if (fallbackResult.reason === "sec_fallback_exhausted") {
      return { status: "already_exists", reason: "sec_fallback_exhausted", secItemsTried } as const;
    }
    return { status: "failed", reason: fallbackResult.reason, secItemsTried } as const;
  }

  if (!candidate) {
    return { status: "failed", reason: "no_candidate", secItemsTried } as const;
  }

  let publishResult = await publishCandidate(rootDir, slot, dateLocal, candidatePath);
  let publishStatus = publishResult.output?.status ?? "unknown";
  if (publishStatus === "already_exists") {
    const fallbackResult = await trySecFallbackPublish(rootDir, slot, dateLocal, 10);
    secItemsTried += fallbackResult.secItemsTried;
    if (fallbackResult.status === "posted") {
      candidate = fallbackResult.candidate;
      const recordId = fallbackResult.recordId;
      await buildDocumentB(recordId);
      const docsStatusPath = path.join(rootDir, "docs", recordId, "status.json");
      let docStatus = await readDocStatus(docsStatusPath);
      if (docStatus === "not_started") {
        docStatus = "needs_review";
      }

      const feedUpdated = await updateFeed({
        rootDir,
        recordId,
        dateLocal,
        slot,
        theme: candidate.theme,
        title: candidate.title,
        canonicalUrl: candidate.canonicalUrl
          ? canonicalizeUrl(candidate.canonicalUrl)
          : canonicalizeUrl(candidate.url),
        docStatus
      });

      return {
        status: "posted",
        recordId,
        theme: candidate.theme,
        title: candidate.title,
        canonicalUrl: candidate.canonicalUrl
          ? canonicalizeUrl(candidate.canonicalUrl)
          : canonicalizeUrl(candidate.url),
        docStatus,
        feedUpdated,
        secItemIndex: fallbackResult.secItemIndex,
        secItemsTried
      } as const;
    }
    if (fallbackResult.reason === "sec_fallback_exhausted") {
      return { status: "already_exists", reason: "sec_fallback_exhausted", secItemsTried } as const;
    }
    return { status: "failed", reason: fallbackResult.reason, secItemsTried } as const;
  }
  if (publishStatus !== "created") {
    return { status: "failed", reason: publishStatus, secItemsTried } as const;
  }

  const recordId = publishResult.output.recordId as string;
  await buildDocumentB(recordId);
  const docsStatusPath = path.join(rootDir, "docs", recordId, "status.json");
  let docStatus = await readDocStatus(docsStatusPath);
  if (docStatus === "not_started") {
    docStatus = "needs_review";
  }

  const feedUpdated = await updateFeed({
    rootDir,
    recordId,
    dateLocal,
    slot,
    theme: candidate.theme,
    title: candidate.title,
    canonicalUrl: candidate.canonicalUrl
      ? canonicalizeUrl(candidate.canonicalUrl)
      : canonicalizeUrl(candidate.url),
    docStatus
  });

  return {
    status: "posted",
    recordId,
    theme: candidate.theme,
    title: candidate.title,
    canonicalUrl: candidate.canonicalUrl
      ? canonicalizeUrl(candidate.canonicalUrl)
      : canonicalizeUrl(candidate.url),
    docStatus,
    feedUpdated,
    secItemIndex: null,
    secItemsTried
  } as const;
}

async function main() {
  const { slot: slotArg, dateLocal: dateArg } = parseArgs();
  const dateLocal = dateArg ?? formatDateKey(TIME_ZONE);
  const slot = resolveSlot(slotArg);
  const orderedSlots = [
    slot,
    nextSlot(slot),
    nextSlot(nextSlot(slot))
  ];
  const triedSlots: Slot[] = [];
  let secItemsTried = 0;
  let lastReason: string | null = null;

  for (const slotAttempt of orderedSlots) {
    triedSlots.push(slotAttempt);
    const result = await attemptSlot(slotAttempt, dateLocal);
    secItemsTried += result.secItemsTried ?? 0;

    if (result.status === "posted") {
      const summary = {
        status: "posted",
        dateLocal,
        slot: slotAttempt,
        recordId: result.recordId,
        theme: result.theme,
        docStatus: result.docStatus,
        feedUpdated: result.feedUpdated,
        secItemIndex: result.secItemIndex
      };
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return;
    }

    if (result.status === "already_exists") {
      lastReason = result.reason ?? "already_exists";
      continue;
    }

    if (result.reason === "sec_fallback_exhausted") {
      lastReason = "sec_fallback_exhausted";
      continue;
    }

    const summary = {
      status: "failed",
      dateLocal,
      slot: slotAttempt,
      reason: result.reason ?? "unknown",
      triedSlots,
      secItemsTried
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const summary = {
    status: "no_new_record_possible_today",
    dateLocal,
    triedSlots,
    secItemsTried,
    reason: lastReason ?? "already_exists"
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`[autopublish] Falha: ${(error as Error).message}`);
  process.exitCode = 1;
});
