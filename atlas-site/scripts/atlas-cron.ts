import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

type FeedSourceConfig = {
  id: string;
  name: string;
  tier: "primary" | "secondary" | "research";
  method: string;
  feed_url?: string;
};

type FeedSource = {
  url: string;
  domain: string;
  kind: "primary" | "secondary" | "research";
  weight: number;
  published_at?: string;
};

type FeedItem = {
  id: string;
  signal_type: "IPO" | "BILLIONAIRE" | "REVENUE_RECORD";
  category_label: string;
  title: string;
  summary: string;
  body: string;
  sector: string;
  canonical_url: string;
  source_name: string;
  og_image?: string;
  excerpt?: string;
  facts: string[];
  entities: {
    name: string;
    type: "person" | "company";
    sector: string;
    geography?: string;
  };
  metrics: {
    amount_usd?: number;
    revenue_usd?: number;
    revenue_period?: string;
    ipo_raise_usd?: number;
    valuation_usd?: number;
  };
  published_at: string;
  event_date?: string;
  sources: FeedSource[];
};

type FeedPayload = {
  version: number;
  generated_at: string;
  items: FeedItem[];
};

type FeedStateEntry = {
  url: string;
  id: string;
  added_at: string;
  published_at?: string;
};

type FeedState = {
  version: number;
  updated_at: string;
  entries: FeedStateEntry[];
};

const OPENROUTER_MODEL = "meta-llama/llama-3.2-3b-instruct:free";
const MAX_OUTPUT_TOKENS = 700;
const MAX_INPUT_TOKENS = 1200;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const FEED_PATH = path.join(rootDir, "content", "atlas", "feed.json");
const STATE_PATH = path.join(rootDir, "content", "atlas", "state.json");
const SOURCES_PATH = path.join(rootDir, "sources.whitelist.json");
const TEMPLATE_PATH = path.join(rootDir, "templates", "document-b.imperial.mdx");

const MAX_ITEMS = 200;
const MAX_PER_SOURCE = 5;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true
});

function log(message: string) {
  console.log(message);
}

function isLlmEnabled() {
  return process.env.ATLAS_LLM_ENABLED === "true";
}

function assertProviderAllowed() {
  const provider = (process.env.ATLAS_LLM_PROVIDER || "").toLowerCase();
  if (provider !== "openrouter") {
    throw new Error("Only OpenRouter is allowed as LLM provider.");
  }
}

function assertModelAllowed() {
  const override = process.env.ATLAS_LLM_MODEL || process.env.OPENROUTER_MODEL || "";
  if (override && override !== OPENROUTER_MODEL) {
    throw new Error("Paid or unsupported model blocked by policy.");
  }
}

function truncateToMaxInputTokens(text: string) {
  const maxChars = MAX_INPUT_TOKENS * 4;
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars);
}

async function callOpenRouter(messages: Array<{ role: string; content: string }>) {
  assertProviderAllowed();
  assertModelAllowed();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required when LLM is enabled.");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Atlas",
      "HTTP-Referer": "https://atlas.local"
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      messages
    })
  });

  if (!response.ok) {
    throw new Error(`OpenRouter error: ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned empty content.");
  }

  return String(content).trim();
}

async function generateCompletion(systemPrompt: string, userPrompt: string) {
  if (!isLlmEnabled()) {
    return null;
  }

  const safeUserPrompt = truncateToMaxInputTokens(userPrompt);
  return callOpenRouter([
    { role: "system", content: systemPrompt },
    { role: "user", content: safeUserPrompt }
  ]);
}

let cachedTemplate: string | null = null;
function loadTemplate() {
  if (!cachedTemplate) {
    cachedTemplate = fs.readFileSync(TEMPLATE_PATH, "utf8");
  }
  return cachedTemplate;
}

function deterministicTemplate(payload: {
  title: string;
  summary: string;
  sourceName: string;
  url: string;
  publishedAt: string;
  entityName: string;
}) {
  const template = loadTemplate();
  const opening = `${payload.title}. ${payload.summary}`.trim();
  const historical = `Published on ${payload.publishedAt} by ${payload.sourceName}. Source: ${payload.url}.`;
  const mechanism =
    "The record reflects institutional disclosure through formal release channels.";
  const agents = `Primary agent: ${payload.entityName}. Gatekeeper: ${payload.sourceName}.`;
  const structural =
    "What institutional sequence does this disclosure continue to shape?";

  return template
    .replace("{{OPENING_PHENOMENON}}", opening)
    .replace("{{HISTORICAL_POSITIONING}}", historical)
    .replace("{{MECHANISM_OF_POWER}}", mechanism)
    .replace("{{AGENTS_INVOLVED}}", agents)
    .replace("{{STRUCTURAL_QUESTION}}", structural);
}

function buildPrompts(payload: {
  title: string;
  summary: string;
  sourceName: string;
  url: string;
  publishedAt: string;
  entityName: string;
}) {
  const template = loadTemplate();
  const systemPrompt =
    "You are Atlas, producing institutional summaries without fluff. Follow the template exactly and keep it concise.";

  const userPrompt = `Fill the placeholders in this template using the provided record details. Do not add extra headings.

TEMPLATE:
${template}

RECORD:
Title: ${payload.title}
Summary: ${payload.summary}
Source: ${payload.sourceName}
URL: ${payload.url}
Published: ${payload.publishedAt}
Entity: ${payload.entityName}
`;

  return { systemPrompt, userPrompt };
}

async function writeDocument(payload: {
  title: string;
  summary: string;
  sourceName: string;
  url: string;
  publishedAt: string;
  entityName: string;
}) {
  if (!isLlmEnabled()) {
    return deterministicTemplate(payload);
  }

  try {
    const { systemPrompt, userPrompt } = buildPrompts(payload);
    const completion = await generateCompletion(systemPrompt, userPrompt);
    if (!completion) {
      return deterministicTemplate(payload);
    }
    return completion.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM error";
    log(`LLM fallback engaged: ${message}`);
    return deterministicTemplate(payload);
  }
}

function readJsonIfExists<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, payload: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function stripHtml(input: string) {
  if (!input) return "";
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseFeed(xml: string) {
  const parsed = parser.parse(xml);

  if (parsed.rss?.channel) {
    const items = ensureArray(parsed.rss.channel.item);
    return items.map((item) => ({
      title: stripHtml(item.title || ""),
      link: typeof item.link === "string" ? item.link.trim() : item.link?.href,
      description: stripHtml(item.description || item.summary || ""),
      pubDate: item.pubDate || item.published || item.updated || "",
      guid: item.guid?.value || item.guid || "",
      image: item.enclosure?.url || item.content?.url || ""
    }));
  }

  if (parsed.feed?.entry) {
    const entries = ensureArray(parsed.feed.entry);
    return entries.map((entry) => {
      const links = ensureArray(entry.link);
      const linkObject = links.find((link) => link.rel === "alternate") || links[0] || {};
      return {
        title: stripHtml(entry.title || ""),
        link: linkObject.href || "",
        description: stripHtml(entry.summary || entry.content || ""),
        pubDate: entry.published || entry.updated || "",
        guid: entry.id || "",
        image: entry.enclosure?.url || ""
      };
    });
  }

  return [];
}

function classifySignal(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("ipo")) return "IPO";
  if (lower.includes("billionaire") || lower.includes("billion")) return "BILLIONAIRE";
  return "REVENUE_RECORD";
}

function classifyLabel(signalType: FeedItem["signal_type"]) {
  if (signalType === "IPO") return "IPO";
  if (signalType === "BILLIONAIRE") return "Billionaire";
  return "Revenue";
}

function deriveEntityName(title: string, sourceName: string) {
  if (!title) return sourceName;
  const split = title.split(" - ")[0]?.split(" | ")[0]?.trim();
  return split || sourceName;
}

function makeId(url: string) {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 12);
}

function normalizeDate(input?: string) {
  const date = input ? new Date(input) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function mapSourceKind(tier: FeedSourceConfig["tier"]) {
  if (tier === "primary") return "primary";
  if (tier === "secondary") return "secondary";
  return "research";
}

function mapSourceWeight(tier: FeedSourceConfig["tier"]) {
  if (tier === "primary") return 1;
  if (tier === "secondary") return 0.6;
  return 0.4;
}

async function buildFeedItem(entry: any, source: FeedSourceConfig): Promise<FeedItem> {
  const title = entry.title || "Untitled";
  const summary = entry.description || title;
  const publishedAt = normalizeDate(entry.pubDate);
  const entityName = deriveEntityName(title, source.name);
  const signalType = classifySignal(`${title} ${summary}`);
  const categoryLabel = classifyLabel(signalType);
  const canonicalUrl = entry.link || source.feed_url || "";
  const urlDomain = (() => {
    try {
      return new URL(canonicalUrl).hostname;
    } catch {
      return "";
    }
  })();

  const body = await writeDocument({
    title,
    summary,
    sourceName: source.name,
    url: canonicalUrl,
    publishedAt,
    entityName
  });

  return {
    id: makeId(canonicalUrl || `${source.id}-${publishedAt}`),
    signal_type: signalType,
    category_label: categoryLabel,
    title,
    summary,
    body,
    sector: "finance",
    canonical_url: canonicalUrl,
    source_name: source.name,
    og_image: entry.image || undefined,
    excerpt: summary.slice(0, 200),
    facts: [`Source: ${source.name}`, `Published: ${publishedAt}`],
    entities: {
      name: entityName,
      type: "company",
      sector: "finance"
    },
    metrics: {},
    published_at: publishedAt,
    event_date: publishedAt,
    sources: [
      {
        url: canonicalUrl,
        domain: urlDomain,
        kind: mapSourceKind(source.tier),
        weight: mapSourceWeight(source.tier),
        published_at: publishedAt
      }
    ]
  };
}

async function run() {
  const sourceConfig = readJsonIfExists<{ sources: FeedSourceConfig[] }>(SOURCES_PATH, {
    sources: []
  });
  const sources = (sourceConfig.sources || []).filter(
    (source) => source.method === "rss" && source.feed_url
  );

  const state = readJsonIfExists<FeedState>(STATE_PATH, {
    version: 3,
    updated_at: new Date().toISOString(),
    entries: []
  });

  const feed = readJsonIfExists<FeedPayload>(FEED_PATH, {
    version: 3,
    generated_at: new Date().toISOString(),
    items: []
  });

  const knownUrls = new Set(state.entries.map((entry) => entry.url));
  const newItems: FeedItem[] = [];

  log(
    `Atlas cron starting. Sources: ${sources.length}. LLM: ${
      isLlmEnabled() ? "enabled" : "disabled"
    }. Model: ${OPENROUTER_MODEL}.`
  );

  for (const source of sources) {
    try {
      const response = await fetch(source.feed_url!, {
        headers: {
          "User-Agent": "Atlas/1.0"
        }
      });

      if (!response.ok) {
        log(`Feed fetch failed (${source.id}): ${response.status}`);
        continue;
      }

      const xml = await response.text();
      const entries = parseFeed(xml).slice(0, MAX_PER_SOURCE);

      for (const entry of entries) {
        if (!entry.link || knownUrls.has(entry.link)) {
          continue;
        }

        const item = await buildFeedItem(entry, source);
        newItems.push(item);
        knownUrls.add(entry.link);

        state.entries.push({
          url: entry.link,
          id: item.id,
          added_at: new Date().toISOString(),
          published_at: item.published_at
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown feed error";
      log(`Feed processing failed (${source.id}): ${message}`);
    }
  }

  const combinedItems = [...newItems, ...feed.items];
  combinedItems.sort((a, b) => (a.published_at < b.published_at ? 1 : -1));

  const nextFeed: FeedPayload = {
    version: 3,
    generated_at: new Date().toISOString(),
    items: combinedItems.slice(0, MAX_ITEMS)
  };

  const nextState: FeedState = {
    version: 3,
    updated_at: new Date().toISOString(),
    entries: state.entries.slice(0, MAX_ITEMS * 4)
  };

  writeJson(FEED_PATH, nextFeed);
  writeJson(STATE_PATH, nextState);

  log(
    `Atlas cron complete. New items: ${newItems.length}. Total items: ${nextFeed.items.length}.`
  );
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  log(`Atlas cron failed: ${message}`);
  process.exit(0);
});
