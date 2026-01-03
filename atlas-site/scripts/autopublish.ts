import fs from "node:fs/promises";
import path from "node:path";

type FeedItem = {
  id: string;
  signal_type: string;
  event_type: string;
  entity: string;
  title: string;
  summary: string;
  canonical_url: string;
  published_at: string;
  event_at: string;
  evidence_pack: {
    sources: Array<{ domain: string; url: string; title?: string; published_at?: string; is_primary?: boolean }>;
    excerpts: Array<{ url: string; domain: string; quote: string }>;
    claims: Array<{ field: string; value: string; source_url: string }>;
  };
};

type FeedPayload = {
  version: number;
  generated_at: string;
  items: FeedItem[];
};

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateFeed(payload: FeedPayload) {
  const errors: string[] = [];
  if (!payload || typeof payload !== "object") {
    errors.push("feed_payload_not_object");
    return errors;
  }
  if (payload.version !== 4) errors.push("feed_version_not_v4");
  if (!isNonEmptyString(payload.generated_at)) errors.push("missing_generated_at");
  if (!Array.isArray(payload.items)) errors.push("items_not_array");
  for (const [index, item] of payload.items.entries()) {
    const prefix = `item_${index}`;
    if (!isNonEmptyString(item.id)) errors.push(`${prefix}_missing_id`);
    if (!isNonEmptyString(item.signal_type)) errors.push(`${prefix}_missing_signal_type`);
    if (!isNonEmptyString(item.event_type)) errors.push(`${prefix}_missing_event_type`);
    if (!isNonEmptyString(item.entity)) errors.push(`${prefix}_missing_entity`);
    if (!isNonEmptyString(item.title)) errors.push(`${prefix}_missing_title`);
    if (!isNonEmptyString(item.summary)) errors.push(`${prefix}_missing_summary`);
    if (!isNonEmptyString(item.canonical_url)) errors.push(`${prefix}_missing_canonical_url`);
    if (!isNonEmptyString(item.published_at)) errors.push(`${prefix}_missing_published_at`);
    if (!isNonEmptyString(item.event_at)) errors.push(`${prefix}_missing_event_at`);
    if (!item.evidence_pack || typeof item.evidence_pack !== "object") {
      errors.push(`${prefix}_missing_evidence_pack`);
    } else {
      if (!Array.isArray(item.evidence_pack.sources) || item.evidence_pack.sources.length === 0) {
        errors.push(`${prefix}_missing_sources`);
      }
      if (!Array.isArray(item.evidence_pack.excerpts) || item.evidence_pack.excerpts.length === 0) {
        errors.push(`${prefix}_missing_excerpts`);
      }
    }
  }
  return errors;
}

async function writeRecords(items: FeedItem[]) {
  if (!items.length) return [];
  const rootDir = process.cwd();
  const outDir = path.join(rootDir, "content", "atlas", "records");
  await fs.mkdir(outDir, { recursive: true });
  const written: string[] = [];

  for (const item of items) {
    const recordPath = path.join(outDir, `${item.id}.md`);
    const lines: string[] = [];
    lines.push(`# ${item.title}`);
    lines.push("");
    lines.push(item.summary);
    lines.push("");
    lines.push(`- Entity: ${item.entity}`);
    lines.push(`- Event type: ${item.event_type.toUpperCase()}`);
    lines.push(`- Event at: ${item.event_at}`);
    lines.push(`- Published at: ${item.published_at}`);
    lines.push(`- Canonical URL: ${item.canonical_url}`);
    if (item.evidence_pack.excerpts.length) {
      lines.push("");
      lines.push("## Evidence excerpts");
      for (const excerpt of item.evidence_pack.excerpts.slice(0, 3)) {
        lines.push(`- (${excerpt.domain}) ${excerpt.quote}`);
      }
    }
    await fs.writeFile(recordPath, lines.join("\n"), "utf8");
    written.push(path.relative(rootDir, recordPath));
  }
  return written;
}

async function main() {
  const rootDir = process.cwd();
  const feedPath = path.join(rootDir, "feed.json");
  const raw = await fs.readFile(feedPath, "utf8");
  const payload = JSON.parse(raw) as FeedPayload;
  const errors = validateFeed(payload);
  if (errors.length) {
    console.error(`[autopublish] feed validation failed: ${errors.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const written = await writeRecords(payload.items);
  const summary = {
    status: "ok",
    items: payload.items.length,
    records_written: written.length,
    records: written
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`[autopublish] Falha: ${(error as Error).message}`);
  process.exitCode = 1;
});
