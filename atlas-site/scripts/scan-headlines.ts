import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

type Slot = "morning" | "noon" | "night";
type Theme = "any" | "ipo" | "billionaire" | "revenue";

type SourceEntry = {
  id?: string;
  name?: string;
  method?: "rss" | "html";
  feed_url?: string;
  url?: string;
  rss?: string;
  feed?: string;
  homepage?: string;
};

type SourceResult = {
  id: string;
  name: string;
  method: string;
  ok: boolean;
  status: "ok" | "skipped" | "error";
  items?: SourceItem[];
  selected: SelectedItem;
  error?: string;
  reason?: string;
  note?: string;
  httpStatus?: number;
  contentType?: string | null;
  bytes?: number;
  debugBodyPreview?: string;
  parseErrorName?: string;
  parseErrorMessage?: string;
  metrics?: SourceMetrics;
};

const SLOT_VALUES = new Set<Slot>(["morning", "noon", "night"]);
const THEME_VALUES = new Set<Theme>(["any", "ipo", "billionaire", "revenue"]);
const DEFAULT_LIMIT = 5;
const DEFAULT_TIMEOUT_MS = 12000;
const PRIMARY_HEADERS = {
  "User-Agent": "imperium-atlas/1.0 (contact: youremail@domain.com)",
  Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
  "Accept-Encoding": "gzip, deflate"
};
const RETRY_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0",
  Accept: PRIMARY_HEADERS.Accept,
  "Accept-Encoding": "gzip, deflate"
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true
});

type SourceItem = {
  title: string | null;
  rawTitle?: string | null;
  url: string | null;
  publishedAtISO: string | null;
  publishedAtRaw?: string | null;
};

type SelectedItem = {
  title: string | null;
  url: string | null;
  publishedAtISO: string | null;
} | null;

type SourceMetrics = {
  fetchMs: number;
  bytes?: number;
  retriesUsed: number;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const slotIdx = args.indexOf("--slot");
  const slot = slotIdx >= 0 ? (args[slotIdx + 1] as Slot | undefined) : undefined;
  if (!slot || !SLOT_VALUES.has(slot)) {
    throw new Error("Informe --slot morning|noon|night.");
  }
  const themeIdx = args.indexOf("--theme");
  const theme = themeIdx >= 0 ? (args[themeIdx + 1] as Theme | undefined) : "any";
  if (!theme || !THEME_VALUES.has(theme)) {
    throw new Error("Informe --theme ipo|billionaire|revenue|any.");
  }
  const limitIdx = args.indexOf("--limit");
  const limitRaw = limitIdx >= 0 ? Number(args[limitIdx + 1]) : DEFAULT_LIMIT;
  if (!Number.isFinite(limitRaw) || limitRaw < 1 || limitRaw > 20) {
    throw new Error("Informe --limit entre 1 e 20.");
  }
  return { slot, theme, limit: Math.floor(limitRaw) };
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadSources(rootDir: string) {
  const rootFile = path.join(rootDir, "sources.whitelist.json");
  const legacyFile = path.join(rootDir, "data", "sources", "whitelist.json");
  const filePath = (await fileExists(rootFile)) ? rootFile : legacyFile;
  const raw = await fs.readFile(filePath, "utf-8");
  const data = JSON.parse(raw) as unknown;

  if (Array.isArray(data)) {
    return { filePath, sources: data as SourceEntry[] };
  }
  if (data && typeof data === "object" && Array.isArray((data as any).sources)) {
    return { filePath, sources: (data as any).sources as SourceEntry[] };
  }
  throw new Error(
    `Arquivo ${path.basename(filePath)} nao contem lista de fontes. ` +
      "Esperado array ou { sources: [...] } com method/rss/url."
  );
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

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\uFFFD/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length ? cleaned : null;
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
  if (!raw) return { publishedAtISO: null, publishedAtRaw: null };
  const trimmed = raw.trim();
  if (!trimmed) return { publishedAtISO: null, publishedAtRaw: null };
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return { publishedAtISO: null, publishedAtRaw: trimmed };
  }
  return { publishedAtISO: date.toISOString(), publishedAtRaw: trimmed };
}

function extractItems(feed: any, limit: number) {
  const results: Array<{ title: string | null; url: string | null; publishedAt: string | null }> = [];
  const rssChannel = feed?.rss?.channel ?? feed?.channel;
  if (rssChannel) {
    const items = toArray(rssChannel.item);
    for (const item of items.slice(0, limit)) {
      results.push({
        title: textValue(item.title),
        url: pickLink(item.link ?? item.guid),
        publishedAt: textValue(item.pubDate ?? item["dc:date"])
      });
    }
  }

  if (!results.length) {
    const atom = feed?.feed;
    if (atom) {
      const entries = toArray(atom.entry);
      for (const entry of entries.slice(0, limit)) {
        results.push({
          title: textValue(entry.title),
          url: pickLink(entry.link),
          publishedAt: textValue(entry.updated ?? entry.published)
        });
      }
    }
  }

  return results;
}

const BLACKLIST_PATTERNS = [
  /price prediction/i,
  /how to/i,
  /investment strategy/i,
  /staking/i,
  /top\s+\d+/i,
  /stocks to buy/i,
  /reasons to buy/i
];

const THEME_KEYWORDS: Record<
  Exclude<Theme, "any">,
  Array<{ term: string | RegExp; weight: number }>
> = {
  ipo: [
    { term: "ipo", weight: 3 },
    { term: "initial public offering", weight: 3 },
    { term: "priced", weight: 2 },
    { term: "pricing", weight: 2 },
    { term: "debut", weight: 2 },
    { term: "files", weight: 2 },
    { term: "filed", weight: 2 },
    { term: "prospectus", weight: 2 },
    { term: /\bs-1\b/, weight: 3 },
    { term: /\bf-1\b/, weight: 3 },
    { term: "listing", weight: 2 },
    { term: "nasdaq debut", weight: 3 },
    { term: "nyse debut", weight: 3 }
  ],
  billionaire: [
    { term: "billionaire", weight: 3 },
    { term: "billionaires", weight: 3 },
    { term: "net worth", weight: 2 },
    { term: "wealth", weight: 2 },
    { term: "fortune", weight: 2 },
    { term: "richest", weight: 2 },
    { term: "forbes", weight: 2 }
  ],
  revenue: [
    { term: "record revenue", weight: 3 },
    { term: "record net revenue", weight: 3 },
    { term: "all-time high", weight: 2 },
    { term: "highest quarterly", weight: 2 },
    { term: "record quarterly", weight: 2 },
    { term: "revenue increased", weight: 2 },
    { term: "results", weight: 1 },
    { term: "earnings release", weight: 2 },
    { term: /\bq1\b/, weight: 1 },
    { term: /\bq2\b/, weight: 1 },
    { term: /\bq3\b/, weight: 1 },
    { term: /\bq4\b/, weight: 1 }
  ]
};

const THEME_PENALTIES: Record<
  Exclude<Theme, "any">,
  Array<{ term: string | RegExp; weight: number }>
> = {
  ipo: [
    { term: "reasons to buy", weight: -3 },
    { term: "stocks to buy", weight: -3 },
    { term: /\b\d+\s+stocks\b/, weight: -2 },
    { term: "top stocks", weight: -2 },
    { term: "pick", weight: -1 }
  ],
  billionaire: [
    { term: "top", weight: -1 },
    { term: "ranking", weight: -1 }
  ],
  revenue: [
    { term: "how to", weight: -2 },
    { term: "prediction", weight: -2 }
  ]
};

function isBlacklisted(title: string | null, url: string | null) {
  const haystack = `${title ?? ""} ${url ?? ""}`;
  return BLACKLIST_PATTERNS.some((pattern) => pattern.test(haystack));
}

function scoreItem(theme: Theme, title: string | null, url: string | null) {
  if (theme === "any") return 0;
  const haystack = `${title ?? ""} ${url ?? ""}`.toLowerCase();
  let score = 0;
  for (const { term, weight } of THEME_KEYWORDS[theme]) {
    if (typeof term === "string") {
      if (haystack.includes(term)) score += weight;
    } else if (term.test(haystack)) {
      score += weight;
    }
  }
  for (const { term, weight } of THEME_PENALTIES[theme]) {
    if (typeof term === "string") {
      if (haystack.includes(term)) score += weight;
    } else if (term.test(haystack)) {
      score += weight;
    }
  }
  return score;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFeed(url: string) {
  let lastStatus: number | null = null;
  let lastError: Error | null = null;
  let retriesUsed = 0;
  const start = Date.now();

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    const headers =
      attempt === 1 && (lastStatus === 400 || lastStatus === 403 || lastError)
        ? RETRY_HEADERS
        : PRIMARY_HEADERS;
    try {
      if (attempt === 1) retriesUsed = 1;
      const response = await fetchWithTimeout(
        url,
        { headers, redirect: "follow" },
        DEFAULT_TIMEOUT_MS
      );
      if (!response.ok) {
        lastStatus = response.status;
        if (attempt < 1) continue;
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      const fetchMs = Date.now() - start;
      const bytes = Buffer.byteLength(text, "utf8");
      return {
        xml: text,
        metrics: { fetchMs, bytes, retriesUsed },
        httpStatus: response.status,
        contentType: response.headers.get("content-type"),
        bytes,
        debugBodyPreview: text.slice(0, 300)
      };
    } catch (error) {
      lastError = error as Error;
      if (attempt < 1) continue;
      throw lastError;
    }
  }
  throw new Error("Falha inesperada ao baixar feed.");
}

function normalizeSource(source: SourceEntry, index: number) {
  const id = source.id ?? source.name ?? source.url ?? `source_${index + 1}`;
  const name = normalizeText(source.name ?? id) ?? id;
  const method = source.method ?? "unknown";
  const feedUrl = source.feed_url ?? source.rss ?? source.feed ?? source.url ?? null;
  const homepage = source.homepage ?? null;
  return { id, name, method, feedUrl, url: source.url ?? feedUrl, homepage };
}

function buildItems(
  rawItems: Array<{ title: string | null; url: string | null; publishedAt: string | null }>
) {
  return rawItems.map((item) => {
    const normalizedTitle = normalizeText(item.title);
    const { publishedAtISO, publishedAtRaw } = normalizePublishedAt(item.publishedAt);
    const output: SourceItem = {
      title: normalizedTitle,
      url: item.url ?? null,
      publishedAtISO
    };
    if (item.title && normalizedTitle !== item.title) {
      output.rawTitle = item.title;
    }
    if (publishedAtRaw) {
      output.publishedAtRaw = publishedAtRaw;
    }
    return output;
  });
}

function selectBestItem(theme: Theme, items: SourceItem[]) {
  if (!items.length) return { selected: null, reason: "no_items" as const };
  if (theme === "any") {
    return { selected: items[0], reason: null as const };
  }
  let bestScore = 0;
  let bestItem: SourceItem | null = null;
  for (const item of items) {
    const score = scoreItem(theme, item.title, item.url);
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }
  if (!bestItem || bestScore <= 0) {
    return { selected: null, reason: "no_theme_match" as const };
  }
  return { selected: bestItem, reason: null as const };
}

async function scanSource(
  source: SourceEntry,
  index: number,
  theme: Theme,
  limit: number
): Promise<SourceResult> {
  const normalized = normalizeSource(source, index);
  if (normalized.method === "html") {
    return {
      id: normalized.id,
      name: normalized.name,
      method: normalized.method,
      ok: false,
      status: "skipped",
      selected: null,
      reason: "html_method_not_implemented_yet",
      error: "html_method_not_implemented_yet"
    };
  }

  if (normalized.method !== "rss") {
    return {
      id: normalized.id,
      name: normalized.name,
      method: normalized.method,
      ok: false,
      status: "error",
      selected: null,
      error: "method_not_supported"
    };
  }

  if (!normalized.feedUrl) {
    return {
      id: normalized.id,
      name: normalized.name,
      method: normalized.method,
      ok: false,
      status: "error",
      selected: null,
      error: "missing_feed_url"
    };
  }

  let fetched: Awaited<ReturnType<typeof fetchFeed>>;
  try {
    fetched = await fetchFeed(normalized.feedUrl);
  } catch (error) {
    return {
      id: normalized.id,
      name: normalized.name,
      method: normalized.method,
      ok: false,
      status: "error",
      selected: null,
      error: (error as Error).message
    };
  }

  let feed: any;
  try {
    feed = parser.parse(fetched.xml);
  } catch (error) {
    const parseError = error as Error;
    return {
      id: normalized.id,
      name: normalized.name,
      method: normalized.method,
      ok: false,
      status: "error",
      selected: null,
      error: "xml_parse_error",
      parseErrorName: parseError.name || "Error",
      parseErrorMessage: parseError.message ? parseError.message.slice(0, 200) : undefined,
      httpStatus: fetched.httpStatus,
      contentType: fetched.contentType,
      bytes: fetched.bytes,
      debugBodyPreview: fetched.debugBodyPreview,
      metrics: fetched.metrics
    };
  }

  const rawItems = extractItems(feed, limit);
  const items = buildItems(rawItems).filter(
    (item) => !isBlacklisted(item.title, item.url)
  );

  if (!items.length) {
    return {
      id: normalized.id,
      name: normalized.name,
      method: normalized.method,
      ok: true,
      status: "ok",
      items: [],
      selected: null,
      note: "no_items",
      httpStatus: fetched.httpStatus,
      contentType: fetched.contentType,
      bytes: fetched.bytes,
      debugBodyPreview: fetched.debugBodyPreview,
      metrics: fetched.metrics
    };
  }

  const { selected, reason } = selectBestItem(theme, items);

  return {
    id: normalized.id,
    name: normalized.name,
    method: normalized.method,
    ok: true,
    status: "ok",
    items,
    selected: selected
      ? { title: selected.title, url: selected.url, publishedAtISO: selected.publishedAtISO }
      : null,
    reason: reason ?? undefined,
    metrics: fetched.metrics
  };
}

async function main() {
  const { slot, theme, limit } = parseArgs();
  const rootDir = process.cwd();
  const dateKey = formatDateKey("America/Sao_Paulo");
  const timestamp = new Date().toISOString();
  const { filePath, sources } = await loadSources(rootDir);

  const results: SourceResult[] = [];
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i];
    try {
      results.push(await scanSource(source, i, theme, limit));
    } catch (error) {
      const fallback = normalizeSource(source, i);
      results.push({
        id: fallback.id,
        name: fallback.name,
        method: fallback.method,
        ok: false,
        status: "error",
        selected: null,
        error: (error as Error).message
      });
    }
  }

  const payload = {
    slot,
    theme,
    dateLocal: dateKey,
    generatedAtUTC: timestamp,
    sourceFile: path.relative(rootDir, filePath),
    totalSources: results.length,
    okSources: results.filter((item) => item.ok).length,
    skippedSources: results.filter((item) => item.status === "skipped").length,
    results
  };

  await fs.mkdir(path.join(rootDir, "logs"), { recursive: true });
  const logPath = path.join(rootDir, "logs", `scan-${dateKey}-${slot}-${theme}.json`);
  const output = JSON.stringify(payload, null, 2);
  await fs.writeFile(logPath, output, "utf8");
  process.stdout.write(`${output}\n`);
}

main().catch((error) => {
  console.error(`[scan] Falha: ${(error as Error).message}`);
  process.exitCode = 1;
});
