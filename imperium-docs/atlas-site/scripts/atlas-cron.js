const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { XMLParser } = require("fast-xml-parser");
const { writeDocument } = require("../src/lib/llm/llmWriter");
const { isLlmEnabled, OPENROUTER_MODEL } = require("../src/lib/llm/llmProvider");

const FEED_PATH = path.join("data", "feed.json");
const STATE_PATH = path.join("data", "state.json");
const MAX_ITEMS = 200;
const MAX_PER_SOURCE = 5;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true
});

function log(message) {
  console.log(message);
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function stripHtml(input) {
  if (!input) return "";
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseFeed(xml) {
  const parsed = parser.parse(xml);

  if (parsed.rss && parsed.rss.channel) {
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

  if (parsed.feed && parsed.feed.entry) {
    const entries = ensureArray(parsed.feed.entry);
    return entries.map((entry) => {
      const links = ensureArray(entry.link);
      const linkObject =
        links.find((link) => link.rel === "alternate") || links[0] || {};
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

function classifySignal(text) {
  const lower = text.toLowerCase();
  if (lower.includes("ipo")) return "IPO";
  if (lower.includes("billionaire") || lower.includes("billion"))
    return "BILLIONAIRE";
  return "REVENUE_RECORD";
}

function classifyLabel(signalType) {
  if (signalType === "IPO") return "IPO";
  if (signalType === "BILLIONAIRE") return "Billionaire";
  return "Revenue";
}

function deriveEntityName(title, sourceName) {
  if (!title) return sourceName;
  const split = title.split(" - ")[0].split(" | ")[0].trim();
  return split || sourceName;
}

function makeId(url) {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 12);
}

function normalizeDate(input) {
  const date = input ? new Date(input) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function mapSourceKind(tier) {
  if (tier === "primary") return "primary";
  if (tier === "secondary") return "secondary";
  return "research";
}

function mapSourceWeight(tier) {
  if (tier === "primary") return 1;
  if (tier === "secondary") return 0.6;
  return 0.4;
}

async function buildFeedItem(entry, source) {
  const title = entry.title || "Untitled";
  const summary = entry.description || title;
  const publishedAt = normalizeDate(entry.pubDate);
  const entityName = deriveEntityName(title, source.name);
  const signalType = classifySignal(`${title} ${summary}`);
  const categoryLabel = classifyLabel(signalType);
  const canonicalUrl = entry.link || source.feed_url;
  const urlDomain = (() => {
    try {
      return new URL(canonicalUrl).hostname;
    } catch {
      return "";
    }
  })();

  const body = await writeDocument(
    {
      title,
      summary,
      sourceName: source.name,
      url: canonicalUrl,
      publishedAt,
      entityName
    },
    (message) => log(message)
  );

  return {
    id: makeId(canonicalUrl),
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
    facts: [
      `Source: ${source.name}`,
      `Published: ${publishedAt}`
    ],
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
  const sourceConfig = readJsonIfExists("sources.whitelist.json", {
    sources: []
  });

  const sources = (sourceConfig.sources || []).filter(
    (source) => source.method === "rss" && source.feed_url
  );

  const state = readJsonIfExists(STATE_PATH, {
    version: 3,
    updated_at: new Date().toISOString(),
    entries: []
  });

  const feed = readJsonIfExists(FEED_PATH, {
    version: 3,
    generated_at: new Date().toISOString(),
    items: []
  });

  const knownUrls = new Set(state.entries.map((entry) => entry.url));
  const newItems = [];

  log(`Atlas cron starting. Sources: ${sources.length}. LLM: ${isLlmEnabled() ? "enabled" : "disabled"}. Model: ${OPENROUTER_MODEL}.`);

  for (const source of sources) {
    try {
      const response = await fetch(source.feed_url, {
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
      log(`Feed processing failed (${source.id}): ${error.message}`);
    }
  }

  const combinedItems = [...newItems, ...feed.items];
  combinedItems.sort((a, b) => (a.published_at < b.published_at ? 1 : -1));

  const nextFeed = {
    version: 3,
    generated_at: new Date().toISOString(),
    items: combinedItems.slice(0, MAX_ITEMS)
  };

  const nextState = {
    version: 3,
    updated_at: new Date().toISOString(),
    entries: state.entries.slice(0, MAX_ITEMS * 4)
  };

  writeJson(FEED_PATH, nextFeed);
  writeJson(STATE_PATH, nextState);

  log(`Atlas cron complete. New items: ${newItems.length}. Total items: ${nextFeed.items.length}.`);
}

run().catch((error) => {
  log(`Atlas cron failed: ${error.message}`);
  process.exit(0);
});
