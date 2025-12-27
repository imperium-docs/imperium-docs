import fs from "node:fs/promises";
import path from "node:path";
import { canonicalizeUrl } from "./lib/canonical-url.ts";

type Slot = "morning" | "noon" | "night";
type Theme = "ipo" | "revenue" | "billionaire";

type ScanPayload = {
  slot?: Slot;
  theme?: Theme;
  dateLocal?: string;
  results?: ScanResult[];
};

type ScanResult = {
  id: string;
  name: string;
  status: "ok" | "skipped" | "error";
  selected: {
    title: string | null;
    url: string | null;
    publishedAtISO: string | null;
  } | null;
};

type Candidate = {
  theme: Theme;
  title: string;
  url: string;
  canonicalUrl: string;
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
const THEME_FILES: Theme[] = ["ipo", "revenue", "billionaire"];
const THEME_WEIGHTS: Record<Theme, number> = {
  ipo: 1.15,
  revenue: 1.05,
  billionaire: 1.1
};
const SOURCE_WEIGHTS: Record<string, number> = {
  sec_press_releases: 3.0,
  nasdaq_rss_ipos: 1.8,
  nasdaq_rss_earnings: 1.4,
  nasdaq_rss_markets: 1.2,
  globenewswire_prospectus: 1.6,
  globenewswire_press_releases: 1.3,
  globenewswire_stock_market_news: 1.2
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

function scoreCandidate(theme: Theme, sourceId: string, publishedAtISO: string | null) {
  const sourceWeight = SOURCE_WEIGHTS[sourceId] ?? 1.0;
  const themeWeight = THEME_WEIGHTS[theme];
  const recency = recencyScore(publishedAtISO);
  return {
    total: sourceWeight * themeWeight * recency,
    sourceWeight,
    themeWeight,
    recencyScore: recency
  };
}

function entityGuessFromTitle(title: string) {
  const raw = normalizeText(title);
  let simplified = raw.replace(/^\d+\s+\w+\s+to\s+/i, "");
  simplified = simplified.replace(/^how to\s+/i, "");
  simplified = simplified.replace(/^\d+\s+/, "");
  const splitMatch = simplified.split(/\s*[:\-]\s*/);
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

async function loadScan(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as ScanPayload;
}

async function main() {
  const { slot, dateLocal: dateFromArgs } = parseArgs();
  const rootDir = process.cwd();
  const dateLocal = dateFromArgs ?? formatDateKey("America/Sao_Paulo");

  const scans = await Promise.all(
    THEME_FILES.map(async (theme) => {
      const filename = `scan-${dateLocal}-${slot}-${theme}.json`;
      const filePath = path.join(rootDir, "logs", filename);
      const payload = await loadScan(filePath);
      return { theme, payload };
    })
  );

  const candidatesByTheme: Record<Theme, number> = {
    ipo: 0,
    revenue: 0,
    billionaire: 0
  };
  const candidates: Candidate[] = [];

  for (const { theme, payload } of scans) {
    const results = payload.results ?? [];
    for (const result of results) {
      if (result.status !== "ok" || !result.selected) continue;
      const title = result.selected.title;
      const url = result.selected.url;
      if (!title || !url) continue;
      const score = scoreCandidate(theme, result.id, result.selected.publishedAtISO ?? null);
      const canonicalUrl = canonicalizeUrl(url);
      candidates.push({
        theme,
        title: normalizeText(title),
        url,
        canonicalUrl,
        publishedAtISO: result.selected.publishedAtISO ?? null,
        source: {
          id: result.id,
          name: result.name,
          weight: score.sourceWeight
        },
        entityGuess: entityGuessFromTitle(title),
        score
      });
      candidatesByTheme[theme] += 1;
    }
  }

  if (!candidates.length) {
    const output = {
      version: 1,
      slot,
      dateLocal,
      generatedAtUTC: new Date().toISOString(),
      status: "none",
      reason: "no_selected_items",
      candidate: null,
      debug: {
        candidatesConsidered: 0,
        candidatesByTheme
      }
    };
    await fs.mkdir(path.join(rootDir, "out"), { recursive: true });
    const outPath = path.join(rootDir, "out", `candidate-${dateLocal}-${slot}.json`);
    await fs.writeFile(outPath, JSON.stringify(output, null, 2), "utf8");
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  const seenUrls = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = candidate.canonicalUrl;
    const existing = seenUrls.get(key);
    if (!existing || candidate.score.total > existing.score.total) {
      seenUrls.set(key, candidate);
    }
  }

  const deduped = Array.from(seenUrls.values());
  const best = deduped.reduce((prev, current) => {
    if (!prev) return current;
    return current.score.total > prev.score.total ? current : prev;
  });

  const output = {
    version: 1,
    slot,
    dateLocal,
    generatedAtUTC: new Date().toISOString(),
    status: "selected",
    reason: null,
    candidate: best,
    debug: {
      candidatesConsidered: deduped.length,
      candidatesByTheme
    }
  };

  await fs.mkdir(path.join(rootDir, "out"), { recursive: true });
  const outPath = path.join(rootDir, "out", `candidate-${dateLocal}-${slot}.json`);
  await fs.writeFile(outPath, JSON.stringify(output, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`[select-candidate] Falha: ${(error as Error).message}`);
  process.exitCode = 1;
});
