import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import { findRecordLedgerPath } from "./lib/find-record-path.ts";
import { buildIssuerAliases, matchIssuerSignals, resolveIssuerCandidate } from "./lib/issuer.ts";
import {
  extractCikFromSecUrl,
  parseSecCompanyFromHtml,
  parseSecCompanyMatches
} from "./lib/sec-recovery.ts";
import { fetchHtmlMetadata } from "./lib/html-metadata.ts";

type DocStatus = "not_started" | "draft" | "published" | "needs_review";
type Theme = "ipo" | "revenue" | "billionaire";

type LedgerRecord = {
  recordId: string;
  dateLocal: string;
  slot: string;
  theme: Theme;
  title: string;
  canonicalUrl: string;
  publishedAtISO: string | null;
  source: { id: string; name: string; weight: number };
  entityGuess: { type: "company" | "person" | "unknown"; name: string };
};

type SourceEntry = {
  url: string;
  publisher: string;
  tier: "primary" | "secondary";
  accessedAtUTC: string;
  note: string;
  extractedIssuerSignals: { matchedAlias: string | null; confidence: "high" | "medium" | "low" };
};

type SourcesPayload = {
  sources: SourceEntry[];
  recoveryAttempted: boolean;
  recoveredIssuer: { name: string; cik: string; ticker?: string; method: string } | null;
  recoveryNotes: string[];
  recoveryTrace?: RecoveryTrace;
  issuerResolution?: {
    issuer: { name: string; type: "company" | "person" | "unknown"; confidence: "high" | "medium" | "low" };
    ticker: string | null;
    cik: string | null;
    aliases: string[];
    notes: string;
  };
  gateStatus?: { issuer: "pass" | "fail"; sources: "pass" | "fail" };
};

type RecoveryTrace = {
  lanesAttempted: Array<"canonical" | "sec_search_ticker" | "sec_search_name">;
  candidates: { issuerCandidates: string[]; tickers: string[] };
  canonicalRecovery: { attempted: boolean; success: boolean; reason: string | null };
  secSearch: {
    attempted: boolean;
    methodUsed: "ticker" | "name" | "none";
    query: string | null;
    resultsCount: number;
    chosen: { name: string; cik: string; score: number } | null;
    failureReason: string | null;
  };
  sourceCollection: {
    attempted: boolean;
    sourcesFound: number;
    failureReason: string | null;
    secFetchError?: {
      httpStatus: number | null;
      contentType: string | null;
      debugBodyPreview: string | null;
    };
  };
};

type ImageMeta = {
  sourceUrl: string;
  credit: string;
  width: number;
  height: number;
  accessedAtUTC: string;
};

type SecTickerEntry = { cik_str: number; ticker: string; title: string };

const TEMPLATE_PATH = path.join("templates", "document-b.imperial.mdx");
const DEFAULT_WHITELIST_PATH = "sources.whitelist.json";

type HtmlMeta = {
  ogTitle: string | null;
  twitterTitle: string | null;
  pageTitle: string | null;
  jsonLdTitle: string | null;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const recordIdx = args.indexOf("--recordId");
  const recordId = recordIdx >= 0 ? args[recordIdx + 1] : undefined;
  if (!recordId) {
    throw new Error("Informe --recordId.");
  }
  const force = args.includes("--force");
  return { recordId, force };
}

function readDocStatus(raw: string | null): DocStatus {
  if (!raw) return "not_started";
  try {
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

function isSourcesPayload(value: unknown): value is SourcesPayload {
  return Boolean(
    value &&
      typeof value === "object" &&
      "sources" in (value as SourcesPayload) &&
      Array.isArray((value as SourcesPayload).sources)
  );
}

async function readSourcesPayload(sourcesPath: string): Promise<SourcesPayload | null> {
  try {
    const raw = await fs.readFile(sourcesPath, "utf8");
    const parsed = JSON.parse(raw) as SourcesPayload | SourceEntry[];
    if (Array.isArray(parsed)) {
      return {
        sources: parsed,
        recoveryAttempted: false,
        recoveredIssuer: null,
        recoveryNotes: []
      };
    }
    if (isSourcesPayload(parsed)) return parsed;
  } catch {
    return null;
  }
  return null;
}

async function writeSourcesPayload(sourcesPath: string, payload: SourcesPayload) {
  await fs.writeFile(sourcesPath, JSON.stringify(payload, null, 2), "utf8");
}

function normalizeTitle(title: string) {
  return title.replace(/\s+/g, " ").trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHost(host: string) {
  return host.replace(/^www\./i, "").toLowerCase();
}

async function loadWhitelistDomains() {
  const whitelistPath = process.env.ATLAS_SOURCES_WHITELIST || DEFAULT_WHITELIST_PATH;
  const raw = await fs.readFile(whitelistPath, "utf8");
  const parsed = JSON.parse(raw) as { sources?: Array<{ feed_url?: string; homepage?: string }> };
  const domains = new Set<string>(["sec.gov", "data.sec.gov", "nyse.com", "nasdaq.com"]);
  for (const source of parsed.sources ?? []) {
    const urls = [source.feed_url, source.homepage].filter(Boolean) as string[];
    for (const url of urls) {
      try {
        const host = normalizeHost(new URL(url).hostname);
        if (host) domains.add(host);
      } catch {
        // ignore malformed
      }
    }
  }
  return Array.from(domains);
}

function isAllowedUrl(url: string, allowedDomains: string[]) {
  try {
    const host = normalizeHost(new URL(url).hostname);
    return allowedDomains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

async function fetchMetaIfAllowed(url: string, allowedDomains: string[]) {
  if (!isAllowedUrl(url, allowedDomains)) {
    return { meta: null as HtmlMeta | null, html: null as string | null, skipped: true };
  }
  try {
    const result = await fetchHtmlMetadata(url);
    return { meta: result.meta as HtmlMeta, html: result.html, skipped: false };
  } catch {
    return { meta: null as HtmlMeta | null, html: null as string | null, skipped: false };
  }
}

function ensureString(value: string | null | undefined, fallback: string) {
  if (value && value.trim()) return value.trim();
  return fallback;
}

function formatUtc() {
  return new Date().toISOString();
}

function httpGet(url: string, headers?: Record<string, string>) {
  return new Promise<Buffer>((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

function httpGetWithMeta(url: string, headers?: Record<string, string>) {
  return new Promise<{
    statusCode: number | null;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  }>((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode ?? null,
            headers: res.headers,
            body: Buffer.concat(chunks)
          })
        );
      })
      .on("error", reject);
  });
}

async function loadSecCompanyTickers() {
  const headers = { "User-Agent": "imperium-atlas/1.0 (contact: youremail@domain.com)" };
  const raw = await httpGet("https://www.sec.gov/files/company_tickers.json", headers);
  const json = JSON.parse(raw.toString("utf8")) as Record<string, SecTickerEntry>;
  return Object.values(json);
}

type IssuerSignals = { matchedAlias: string | null; confidence: "high" | "medium" | "low" };

function toTextSample(buffer: Buffer) {
  const text = buffer.toString("utf8");
  return text.length > 200000 ? text.slice(0, 200000) : text;
}

function evaluateIssuerSignals(
  text: string,
  aliases: string[],
  tickers: string[]
): IssuerSignals {
  const signals = matchIssuerSignals(text, aliases, tickers);
  if (signals.confidence === "high") {
    return { matchedAlias: signals.matchedAlias, confidence: "high" };
  }
  return { matchedAlias: null, confidence: "low" };
}

async function fetchIssuerSignalsForUrl(
  url: string,
  aliases: string[],
  tickers: string[],
  headers?: Record<string, string>
) {
  try {
    const raw = await httpGet(url, headers);
    const text = toTextSample(raw);
    return evaluateIssuerSignals(text, aliases, tickers);
  } catch {
    return null;
  }
}

async function loadSecSubmissions(cik: string) {
  const headers = { "User-Agent": "imperium-atlas/1.0 (contact: youremail@domain.com)" };
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const raw = await httpGet(url, headers);
  return JSON.parse(raw.toString("utf8")) as any;
}

async function loadSecSubmissionsWithMeta(cik: string) {
  const headers = { "User-Agent": "imperium-atlas/1.0 (contact: youremail@domain.com)" };
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const response = await httpGetWithMeta(url, headers);
  const bodyText = response.body.toString("utf8");
  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
    throw {
      message: "sec_submissions_non_200",
      meta: {
        httpStatus: response.statusCode,
        contentType: String(response.headers["content-type"] ?? ""),
        debugBodyPreview: bodyText.slice(0, 300)
      }
    };
  }
  try {
    return {
      data: JSON.parse(bodyText) as any,
      meta: {
        httpStatus: response.statusCode,
        contentType: String(response.headers["content-type"] ?? ""),
        debugBodyPreview: bodyText.slice(0, 300)
      }
    };
  } catch {
    throw {
      message: "sec_submissions_parse_failed",
      meta: {
        httpStatus: response.statusCode,
        contentType: String(response.headers["content-type"] ?? ""),
        debugBodyPreview: bodyText.slice(0, 300)
      }
    };
  }
}

function padCik(cik: number) {
  return cik.toString().padStart(10, "0");
}

function buildSecArchiveUrl(cik: string, accession: string, doc: string) {
  const cleanAccession = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${cleanAccession}/${doc}`;
}

function pickLatestFilings(submissions: any, forms: string[]) {
  const recent = submissions.filings?.recent;
  if (!recent) return [];
  const entries: Array<{
    form: string;
    accessionNumber: string;
    filingDate: string;
    primaryDocument: string;
  }> = [];
  const count = recent.form?.length ?? 0;
  for (let i = 0; i < count; i += 1) {
    entries.push({
      form: recent.form[i],
      accessionNumber: recent.accessionNumber[i],
      filingDate: recent.filingDate[i],
      primaryDocument: recent.primaryDocument[i]
    });
  }
  const filtered = entries.filter((entry) => forms.includes(entry.form));
  filtered.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  return filtered;
}

async function collectSources(
  ledger: LedgerRecord,
  docsDir: string
): Promise<{ payload: SourcesPayload; issuerName: string; warnings: string[] }> {
  const warnings: string[] = [];
  const sourcesPath = path.join(docsDir, "sources.json");
  const existingPayload = await readSourcesPayload(sourcesPath);
  if (existingPayload) {
    const hasSignals = existingPayload.sources.every(
      (entry) => "extractedIssuerSignals" in entry
    );
    if (existingPayload.sources.length >= 5 && hasSignals) {
      return { payload: existingPayload, issuerName: ledger.entityGuess.name, warnings };
    }
  }

  const issuerCandidate = resolveIssuerCandidate(ledger.title, ledger.entityGuess);
  const { aliases, tickers } = buildIssuerAliases(ledger.title, issuerCandidate);
  const issuerTickers = new Set(tickers.map((ticker) => ticker.toLowerCase()));
  let issuerName = issuerCandidate;
  const accessedAtUTC = formatUtc();
  const sources: SourceEntry[] = [];

  const addSource = (entry: SourceEntry) => {
    if (sources.some((item) => item.url === entry.url)) return;
    sources.push(entry);
  };

  const canonicalSignals = await fetchIssuerSignalsForUrl(ledger.canonicalUrl, aliases, tickers);
  if (canonicalSignals && canonicalSignals.confidence === "high") {
    addSource({
      url: ledger.canonicalUrl,
      publisher: ledger.source.name,
      tier: "primary",
      accessedAtUTC,
      note: "Canonical URL anchor.",
      extractedIssuerSignals: canonicalSignals
    });
  } else {
    warnings.push("canonical_url_unverified");
  }

  let secMatch:
    | { entry: SecTickerEntry; signals: IssuerSignals; score: number }
    | null = null;
  try {
    const secTickers = await loadSecCompanyTickers();
    const matches = secTickers
      .map((entry) => {
        const titleSignals = evaluateIssuerSignals(entry.title, aliases, tickers);
        const tickerLower = entry.ticker.toLowerCase();
        const tickerMatch = issuerTickers.has(tickerLower);
        const score = (titleSignals.matchedAlias ? 3 : 0) + (tickerMatch ? 2 : 0);
        const signals =
          titleSignals.matchedAlias || !tickerMatch
            ? titleSignals
            : { matchedAlias: tickerLower, confidence: "high" as const };
        return { entry, signals, score };
      })
      .filter((match) => match.score > 0);
    matches.sort((a, b) => b.score - a.score);
    secMatch = matches[0] ?? null;
  } catch {
    warnings.push("sec_lookup_failed");
  }

  if (secMatch) {
    issuerName = secMatch.entry.title;
    if (secMatch.entry.ticker) issuerTickers.add(secMatch.entry.ticker.toLowerCase());
    const cik = padCik(secMatch.entry.cik_str);
    try {
      const submissions = await loadSecSubmissions(cik);
      const formsPriority = ["424B4", "S-1", "S-1/A", "F-1", "F-1/A", "8-K"];
      const primaryList = pickLatestFilings(submissions, formsPriority);
      if (primaryList.length) {
        const primary = primaryList[0];
        const primarySignals = secMatch.signals;
        addSource({
          url: buildSecArchiveUrl(cik, primary.accessionNumber, primary.primaryDocument),
          publisher: "SEC EDGAR",
          tier: sources.some((entry) => entry.tier === "primary") ? "secondary" : "primary",
          accessedAtUTC,
          note: `Form ${primary.form} filed ${primary.filingDate}.`,
          extractedIssuerSignals: primarySignals
        });
      }

      const secondaryForms = ["S-1", "S-1/A", "424B4", "8-K", "F-1", "F-1/A"];
      const secondary = pickLatestFilings(submissions, secondaryForms);
      for (const entry of secondary) {
        if (sources.length >= 5) break;
        const url = buildSecArchiveUrl(cik, entry.accessionNumber, entry.primaryDocument);
        if (sources.some((item) => item.url === url)) continue;
        addSource({
          url,
          publisher: "SEC EDGAR",
          tier: "secondary",
          accessedAtUTC,
          note: `Form ${entry.form} filed ${entry.filingDate}.`,
          extractedIssuerSignals: secMatch.signals
        });
      }

      const exchanges = submissions.exchanges ?? [];
      const tickersList = submissions.tickers ?? [];
      const ticker = tickersList[0];
      if (ticker) issuerTickers.add(ticker.toLowerCase());
      if (sources.length < 5 && ticker && exchanges.includes("NYSE")) {
        const exchangeSignals = issuerTickers.has(ticker.toLowerCase())
          ? { matchedAlias: ticker.toLowerCase(), confidence: "high" as const }
          : { matchedAlias: null, confidence: "low" as const };
        if (exchangeSignals.confidence === "high") {
          addSource({
            url: `https://www.nyse.com/quote/XNYS:${ticker}`,
            publisher: "NYSE",
            tier: "secondary",
            accessedAtUTC,
            note: "Exchange listing page.",
            extractedIssuerSignals: exchangeSignals
          });
        } else {
          warnings.push("exchange_unverified");
        }
      }
    } catch {
      warnings.push("sec_submissions_failed");
    }
  } else {
    warnings.push("issuer_not_resolved");
  }

  if (sources.length < 5) {
    warnings.push("insufficient_sources");
  }

  const traceCandidate = resolveIssuerCandidate(ledger.title, ledger.entityGuess);
  const traceAliases = buildIssuerAliases(ledger.title, traceCandidate);
  const trace: RecoveryTrace = {
    lanesAttempted: [],
    candidates: {
      issuerCandidates: [traceCandidate, ...traceAliases.aliases].filter(Boolean),
      tickers: traceAliases.tickers
    },
    canonicalRecovery: { attempted: false, success: false, reason: null },
    secSearch: {
      attempted: false,
      methodUsed: "none",
      query: null,
      resultsCount: 0,
      chosen: null,
      failureReason: null
    },
    sourceCollection: { attempted: false, sourcesFound: sources.length, failureReason: null }
  };
  const payload: SourcesPayload = {
    sources: sources.slice(0, 5),
    recoveryAttempted: false,
    recoveredIssuer: null,
    recoveryNotes: [],
    recoveryTrace: trace
  };
  await writeSourcesPayload(sourcesPath, payload);
  return { payload, issuerName, warnings };
}

function parseFilingInfo(note: string) {
  const formMatch = note.match(/Form\\s+([A-Z0-9-]+)/i);
  const dateMatch = note.match(/(\\d{4}-\\d{2}-\\d{2})/);
  return {
    form: formMatch ? formMatch[1].toUpperCase() : "FILING",
    date: dateMatch ? dateMatch[1] : null
  };
}

async function resolveIssuerFromSecCanonical(
  ledger: LedgerRecord
): Promise<{ name: string; cik: string; method: string } | null> {
  const cikFromUrl = extractCikFromSecUrl(ledger.canonicalUrl);
  if (!cikFromUrl) return null;
  const headers = { "User-Agent": "imperium-atlas/1.0 (contact: youremail@domain.com)" };
  try {
    const raw = await httpGet(ledger.canonicalUrl, headers);
    const parsed = parseSecCompanyFromHtml(raw.toString("utf8"));
    if (parsed?.name) {
      return { name: parsed.name, cik: parsed.cik, method: "canonical_url" };
    }
  } catch {
    // fall through to submissions
  }
  try {
    const submissions = await loadSecSubmissions(cikFromUrl.padStart(10, "0"));
    if (submissions?.name) {
      return { name: submissions.name, cik: cikFromUrl.padStart(10, "0"), method: "canonical_url" };
    }
  } catch {
    return null;
  }
  return null;
}

async function resolveIssuerFromSecSearch(
  aliases: string[],
  tickers: string[]
): Promise<{
  resolved: { name: string; cik: string; ticker?: string; method: string } | null;
  trace: RecoveryTrace["secSearch"];
}> {
  const headers = { "User-Agent": "imperium-atlas/1.0 (contact: youremail@domain.com)" };
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  const trace: RecoveryTrace["secSearch"] = {
    attempted: false,
    methodUsed: "none",
    query: null,
    resultsCount: 0,
    chosen: null,
    failureReason: null
  };

  const scoreMatch = async (match: { name: string; cik: string }, alias: string) => {
    const normalizedAlias = normalize(alias);
    const normalizedName = normalize(match.name);
    let score = 0;
    if (normalizedName === normalizedAlias) score += 5;
    if (normalizedName.includes(normalizedAlias)) score += 3;
    score += Math.max(0, 3 - Math.abs(normalizedName.length - normalizedAlias.length) / 10);
    try {
      const submissions = await loadSecSubmissions(match.cik);
      const recent = submissions.filings?.recent?.filingDate;
      const latest = Array.isArray(recent) ? recent[0] : null;
      if (latest) score += 1;
    } catch {
      // ignore recency score
    }
    return score;
  };

  const orderedTickers = tickers.map((ticker) => ticker.toUpperCase());
  for (const ticker of orderedTickers) {
    if (!ticker) continue;
    trace.attempted = true;
    trace.methodUsed = "ticker";
    trace.query = ticker;
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(
      ticker
    )}&owner=exclude&action=getcompany`;
    try {
      const raw = await httpGet(url, headers);
      const matches = parseSecCompanyMatches(raw.toString("utf8"));
      trace.resultsCount = matches.length;
      if (matches.length === 1) {
        trace.chosen = { name: matches[0].name, cik: matches[0].cik, score: 1 };
        return {
          resolved: {
            name: matches[0].name,
            cik: matches[0].cik,
            ticker,
            method: "sec_search_ticker"
          },
          trace
        };
      }
      if (matches.length > 1) {
        const scored = await Promise.all(
          matches.map(async (match) => ({
            match,
            score: await scoreMatch(match, ticker)
          }))
        );
        scored.sort((a, b) => b.score - a.score);
        trace.chosen = {
          name: scored[0].match.name,
          cik: scored[0].match.cik,
          score: scored[0].score
        };
        return {
          resolved: {
            name: scored[0].match.name,
            cik: scored[0].match.cik,
            ticker,
            method: "sec_search_ticker"
          },
          trace
        };
      }
    } catch {
      // continue
    }
  }

  const ordered = aliases.slice().sort((a, b) => b.length - a.length);
  for (const alias of ordered) {
    if (!alias) continue;
    trace.attempted = true;
    trace.methodUsed = "name";
    trace.query = alias;
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(
      alias
    )}&owner=exclude&action=getcompany`;
    try {
      const raw = await httpGet(url, headers);
      const matches = parseSecCompanyMatches(raw.toString("utf8"));
      trace.resultsCount = matches.length;
      if (matches.length === 1) {
        trace.chosen = { name: matches[0].name, cik: matches[0].cik, score: 1 };
        return {
          resolved: { name: matches[0].name, cik: matches[0].cik, method: "sec_search_name" },
          trace
        };
      }
      if (matches.length > 1) {
        const scored = await Promise.all(
          matches.map(async (match) => ({
            match,
            score: await scoreMatch(match, alias)
          }))
        );
        scored.sort((a, b) => b.score - a.score);
        trace.chosen = {
          name: scored[0].match.name,
          cik: scored[0].match.cik,
          score: scored[0].score
        };
        return {
          resolved: {
            name: scored[0].match.name,
            cik: scored[0].match.cik,
            method: "sec_search_name"
          },
          trace
        };
      }
    } catch {
      // try next alias
    }
  }
  trace.failureReason = "no_sec_matches";
  return { resolved: null, trace };
}

async function buildSourcesFromSecCik(
  ledger: LedgerRecord,
  issuerName: string,
  cik: string,
  aliases: string[],
  tickers: string[]
) {
  const warnings: string[] = [];
  const accessedAtUTC = formatUtc();
  const sources: SourceEntry[] = [];
  const issuerSignals = evaluateIssuerSignals(issuerName, aliases, tickers);
  const sourceTrace: RecoveryTrace["sourceCollection"] = {
    attempted: true,
    sourcesFound: 0,
    failureReason: null
  };

  try {
    const submissionsResponse = await loadSecSubmissionsWithMeta(cik);
    const submissions = submissionsResponse.data;
    const formsPriority = ["10-Q", "10-K", "8-K", "6-K", "424B4", "S-1", "S-1/A", "F-1", "F-1/A"];
    const primaryList = pickLatestFilings(submissions, formsPriority);
    if (primaryList.length) {
      const primary = primaryList[0];
      sources.push({
        url: buildSecArchiveUrl(cik, primary.accessionNumber, primary.primaryDocument),
        publisher: "SEC EDGAR",
        tier: "primary",
        accessedAtUTC,
        note: `Form ${primary.form} filed ${primary.filingDate}.`,
        extractedIssuerSignals: issuerSignals
      });
    }

    const secondaryForms = ["10-Q", "10-K", "8-K", "6-K", "S-1", "S-1/A", "424B4", "F-1", "F-1/A"];
    const secondary = pickLatestFilings(submissions, secondaryForms);
    for (const entry of secondary) {
      if (sources.length >= 5) break;
      const url = buildSecArchiveUrl(cik, entry.accessionNumber, entry.primaryDocument);
      if (sources.some((item) => item.url === url)) continue;
      sources.push({
        url,
        publisher: "SEC EDGAR",
        tier: "secondary",
        accessedAtUTC,
        note: `Form ${entry.form} filed ${entry.filingDate}.`,
        extractedIssuerSignals: issuerSignals
      });
    }

    if (sources.length < 5) {
      const recent = submissions.filings?.recent;
      const count = recent?.form?.length ?? 0;
      for (let i = 0; i < count && sources.length < 5; i += 1) {
        const accessionNumber = recent.accessionNumber[i];
        const primaryDocument = recent.primaryDocument[i];
        const form = recent.form[i];
        const filingDate = recent.filingDate[i];
        const url = buildSecArchiveUrl(cik, accessionNumber, primaryDocument);
        if (sources.some((item) => item.url === url)) continue;
        sources.push({
          url,
          publisher: "SEC EDGAR",
          tier: "secondary",
          accessedAtUTC,
          note: `Form ${form} filed ${filingDate}.`,
          extractedIssuerSignals: issuerSignals
        });
      }
    }

    if (sources.length < 5) {
      const exchangeList = submissions.exchanges ?? [];
      const tickerList = submissions.tickers ?? [];
      const ticker = tickerList[0];
      if (ticker) {
        const normalizedTicker = ticker.toLowerCase();
        const exchangeSignals = tickers.map((t) => t.toLowerCase()).includes(normalizedTicker)
          ? { matchedAlias: normalizedTicker, confidence: "high" as const }
          : { matchedAlias: null, confidence: "low" as const };
        if (exchangeSignals.confidence === "high") {
          if (exchangeList.includes("NYSE")) {
            sources.push({
              url: `https://www.nyse.com/quote/XNYS:${ticker}`,
              publisher: "NYSE",
              tier: "secondary",
              accessedAtUTC,
              note: "Exchange listing page.",
              extractedIssuerSignals: exchangeSignals
            });
          } else {
            sources.push({
              url: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}`,
              publisher: "Nasdaq",
              tier: "secondary",
              accessedAtUTC,
              note: "Exchange listing page.",
              extractedIssuerSignals: exchangeSignals
            });
          }
        }
      }
    }
  } catch (error) {
    warnings.push("sec_fetch_failed");
    sourceTrace.failureReason = "sec_fetch_failed";
    if (error && typeof error === "object" && "meta" in (error as any)) {
      const meta = (error as any).meta as {
        httpStatus: number | null;
        contentType: string | null;
        debugBodyPreview: string | null;
      };
      sourceTrace.secFetchError = {
        httpStatus: meta.httpStatus,
        contentType: meta.contentType,
        debugBodyPreview: meta.debugBodyPreview
      };
    }
  }

  sourceTrace.sourcesFound = sources.length;
  if (sources.length < 5) {
    warnings.push("recovery_insufficient_sources");
    sourceTrace.failureReason = sourceTrace.failureReason ?? "insufficient_sources";
  }

  return { sources, warnings, sourceTrace };
}

async function recoverSources(
  ledger: LedgerRecord,
  docsDir: string,
  initialPayload: SourcesPayload
): Promise<{ payload: SourcesPayload; issuerName: string; warnings: string[] } | null> {
  const warnings: string[] = [];
  const issuerCandidate = resolveIssuerCandidate(ledger.title, ledger.entityGuess);
  const { aliases, tickers } = buildIssuerAliases(ledger.title, issuerCandidate);
  const candidateNote = `issuer_candidates=${[issuerCandidate, ...aliases].filter(Boolean).join(
    "|"
  )}`;

  const trace: RecoveryTrace = {
    lanesAttempted: [],
    candidates: { issuerCandidates: [issuerCandidate, ...aliases].filter(Boolean), tickers },
    canonicalRecovery: { attempted: false, success: false, reason: null },
    secSearch: {
      attempted: false,
      methodUsed: "none",
      query: null,
      resultsCount: 0,
      chosen: null,
      failureReason: null
    },
    sourceCollection: { attempted: false, sourcesFound: 0, failureReason: null }
  };

  trace.canonicalRecovery.attempted = true;
  trace.lanesAttempted.push("canonical");
  let recovered = await resolveIssuerFromSecCanonical(ledger);
  if (!recovered) {
    trace.canonicalRecovery.reason = "canonical_unresolved";
    warnings.push("recovery_canonical_failed");
  } else {
    trace.canonicalRecovery.success = true;
  }

  if (!recovered) {
    const secSearch = await resolveIssuerFromSecSearch(aliases, tickers);
    trace.secSearch = secSearch.trace;
    if (trace.secSearch.methodUsed === "ticker") {
      trace.lanesAttempted.push("sec_search_ticker");
    } else if (trace.secSearch.methodUsed === "name") {
      trace.lanesAttempted.push("sec_search_name");
    }
    recovered = secSearch.resolved;
  }

  if (!recovered) {
    trace.secSearch.failureReason = trace.secSearch.failureReason ?? "sec_search_unresolved";
    const payload: SourcesPayload = {
      ...initialPayload,
      recoveryAttempted: true,
      recoveredIssuer: null,
      recoveryNotes: [
        ...initialPayload.recoveryNotes,
        candidateNote,
        ...warnings,
        "recovery_unresolved"
      ],
      recoveryTrace: trace
    };
    await writeSourcesPayload(path.join(docsDir, "sources.json"), payload);
    return { payload, issuerName: issuerCandidate, warnings };
  }

  const recoveryAliases = buildIssuerAliases(ledger.title, recovered.name);
  const sourcesResult = await buildSourcesFromSecCik(
    ledger,
    recovered.name,
    recovered.cik,
    recoveryAliases.aliases,
    recoveryAliases.tickers
  );
  trace.sourceCollection = sourcesResult.sourceTrace;
  const payload: SourcesPayload = {
    sources: sourcesResult.sources.slice(0, 5),
    recoveryAttempted: true,
    recoveredIssuer: {
      name: recovered.name,
      cik: recovered.cik,
      ticker: recovered.ticker,
      method: recovered.method
    },
    recoveryNotes: [candidateNote, `recovery_method=${recovered.method}`, ...sourcesResult.warnings],
    recoveryTrace: trace
  };
  await writeSourcesPayload(path.join(docsDir, "sources.json"), payload);
  return { payload, issuerName: recovered.name, warnings };
}

async function selectImage(
  sources: SourceEntry[],
  docsDir: string
): Promise<{ image: ImageMeta | null; warnings: string[] }> {
  const warnings: string[] = [];
  const verifiedSources = sources.filter(
    (entry) =>
      entry.extractedIssuerSignals.confidence === "high" &&
      entry.extractedIssuerSignals.matchedAlias
  );
  const primary = verifiedSources.find((item) => item.tier === "primary");
  if (!primary || !primary.url.includes("sec.gov/Archives/edgar/data")) {
    warnings.push("no_sec_primary_for_image");
    return { image: null, warnings };
  }

  const primaryUrl = primary.url;
  const baseDir = primaryUrl.substring(0, primaryUrl.lastIndexOf("/") + 1);
  const headers = { "User-Agent": "imperium-atlas/1.0 (contact: youremail@domain.com)" };
  const listing = (await httpGet(baseDir, headers)).toString("utf8");
  const matches = Array.from(listing.matchAll(/href=\"(g[^\"\\s]+\\.(jpg|jpeg))\"/gi)).map(
    (m) => m[1]
  );
  const unique = [...new Set(matches)];

  const candidates: Array<{ url: string; width: number; height: number }> = [];
  for (const file of unique) {
    const url = baseDir + file;
    const buf = await httpGet(url, headers);
    const size = readJpegSize(buf);
    if (size) {
      candidates.push({ url, width: size.width, height: size.height });
    }
  }

  if (!candidates.length) {
    warnings.push("no_images_found");
    return { image: null, warnings };
  }

  const exact = candidates.find((img) => img.width === 1920 && img.height === 1080);
  let chosen = exact;
  if (!chosen) {
    const targetRatio = 16 / 9;
    candidates.sort((a, b) => {
      const aScore = Math.abs(a.width / a.height - targetRatio);
      const bScore = Math.abs(b.width / b.height - targetRatio);
      return aScore - bScore;
    });
    chosen = candidates[0];
    warnings.push("no_exact_1920x1080_image");
  }

  const image: ImageMeta = {
    sourceUrl: chosen.url,
    credit: "SEC EDGAR (issuer filing image)",
    width: chosen.width,
    height: chosen.height,
    accessedAtUTC: formatUtc()
  };

  await fs.writeFile(path.join(docsDir, "image.json"), JSON.stringify(image, null, 2), "utf8");
  return { image, warnings };
}

function readJpegSize(buffer: Buffer) {
  let i = 2;
  while (i < buffer.length) {
    if (buffer[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buffer[i + 1];
    const len = buffer.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = buffer.readUInt16BE(i + 5);
      const width = buffer.readUInt16BE(i + 7);
      return { width, height };
    }
    i += 2 + len;
  }
  return null;
}

function buildSectionText(
  ledger: LedgerRecord,
  issuerName: string,
  sources: SourceEntry[]
) {
  const primary = sources.find((entry) => entry.tier === "primary");
  const primaryInfo = primary ? parseFilingInfo(primary.note) : { form: "FILING", date: null };
  const filingDates = sources
    .map((entry) => parseFilingInfo(entry.note).date)
    .filter((date): date is string => Boolean(date));
  const uniqueDates = Array.from(new Set(filingDates)).sort();
  const opening = [
    `This entry records the transition of ${issuerName} into a public issuer through an IPO process governed by filings.`,
    `The primary anchor is ${primaryInfo.form} ${
      primaryInfo.date ? `filed ${primaryInfo.date}` : "filed on record"
    }, which consolidates the offering into a public instrument.`,
    `The record aligns with the exchange listing referenced in the sources, marking the operational shift into the public market framework.`
  ].join("\n\n");

  const historical = [
    `The filing sequence establishes a dated trail that defines the path to admission.`,
    uniqueDates.length
      ? `The recorded filings span ${uniqueDates.join(", ")} and document the progression from registration to final prospectus.`
      : "The recorded filings document the progression from registration to final prospectus.",
    `This sequence is preserved without narrative, as a mechanical transition between private status and public disclosure.`
  ].join("\n\n");

  const mechanism = [
    `The IPO mechanism enforces disclosure, pricing discipline, and ongoing reporting obligations.`,
    `Registration, amendment, and final prospectus filings operate as the formal controls that bind issuer conduct to public rules.`,
    `Once listed, ongoing reports extend the record into a continuous archive of required statements.`
  ].join("\n\n");

  const agents = [
    `The issuer is identified through its filings and ticker designation, and acts within the constraints of the filing system.`,
    `The SEC archive serves as the canonical repository, and the exchange listing functions as the operational gatekeeper.`,
    `No discretionary interpretation is preserved here; only the documented institutional roles are retained.`
  ].join("\n\n");

  const structuralQuestion =
    "What obligations become structurally binding when the filing sequence resolves into a permanent listing state?";

  return { opening, historical, mechanism, agents, structuralQuestion };
}

function fillTemplate(template: string, sections: ReturnType<typeof buildSectionText>) {
  return template
    .replace("{{OPENING_PHENOMENON}}", sections.opening)
    .replace("{{HISTORICAL_POSITIONING}}", sections.historical)
    .replace("{{MECHANISM_OF_POWER}}", sections.mechanism)
    .replace("{{AGENTS_INVOLVED}}", sections.agents)
    .replace("{{STRUCTURAL_QUESTION}}", sections.structuralQuestion);
}

function evaluateIssuerVerification(sources: SourceEntry[]) {
  const highConfidence = sources.filter(
    (entry) =>
      entry.extractedIssuerSignals.confidence === "high" &&
      entry.extractedIssuerSignals.matchedAlias
  );
  const primary = sources.find((entry) => entry.tier === "primary");
  const primaryHigh = primary
    ? primary.extractedIssuerSignals.confidence === "high" &&
      Boolean(primary.extractedIssuerSignals.matchedAlias)
    : true;
  const passed = highConfidence.length >= 3 && primaryHigh;
  return { passed, highCount: highConfidence.length, primaryHigh };
}

async function main() {
  const { recordId, force } = parseArgs();
  const rootDir = process.cwd();
  const recordsRoot = path.join(rootDir, "records");
  const docsDir = path.join(rootDir, "docs", recordId);
  const v1Path = path.join(docsDir, "v1.mdx");
  const statusPath = path.join(docsDir, "status.json");

  const ledgerPath = await findRecordLedgerPath(recordsRoot, recordId);
  if (!ledgerPath.found || !ledgerPath.path) {
    const summary = {
      recordId,
      templateUsed: TEMPLATE_PATH,
      sourcesCount: 0,
      imageSelected: false,
      status: "missing_ledger"
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  if (!force && (await fs.access(v1Path).then(() => true).catch(() => false))) {
    const summary = {
      recordId,
      templateUsed: TEMPLATE_PATH,
      sourcesCount: 0,
      imageSelected: false,
      status: "already_exists"
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  await fs.mkdir(docsDir, { recursive: true });
  const ledger = JSON.parse(await fs.readFile(ledgerPath.path, "utf8")) as LedgerRecord;
  const normalizedTitle = normalizeTitle(ledger.title);
  ledger.title = normalizedTitle;

  const initial = await collectSources(ledger, docsDir);
  let currentPayload = initial.payload;
  let issuerName = initial.issuerName;
  let sourceWarnings = initial.warnings;
  let issuerVerification = evaluateIssuerVerification(currentPayload.sources);

  if (!issuerVerification.passed) {
    const recovered = await recoverSources(ledger, docsDir, currentPayload);
    if (recovered) {
      currentPayload = recovered.payload;
      issuerName = recovered.issuerName;
      sourceWarnings = [...sourceWarnings, ...recovered.warnings, "recovery_attempted"];
      issuerVerification = evaluateIssuerVerification(currentPayload.sources);
    }
  }

  if (!issuerVerification.passed) {
    const updatedStatus = {
      status: "needs_review",
      updatedAtUTC: formatUtc(),
      reason: "issuer_verification_failed"
    };
    await fs.writeFile(statusPath, JSON.stringify(updatedStatus, null, 2), "utf8");
    await fs.rm(v1Path, { force: true });
    const summary = {
      recordId,
      templateUsed: TEMPLATE_PATH,
      sourcesCount: currentPayload.sources.length,
      imageSelected: false,
      status: "needs_review",
      warnings: sourceWarnings,
      issuerVerification,
      recoveryTrace: currentPayload.recoveryTrace ?? null
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const { image, warnings: imageWarnings } = await selectImage(currentPayload.sources, docsDir);

  const template = await fs.readFile(path.join(rootDir, TEMPLATE_PATH), "utf8");
  const sections = buildSectionText(ledger, issuerName, currentPayload.sources);
  const document = fillTemplate(template, sections);
  await fs.writeFile(v1Path, document, "utf8");

  const existingStatus = await fs.readFile(statusPath, "utf8").catch(() => null);
  const docStatus = readDocStatus(existingStatus);
  const updatedStatus = {
    status: "draft",
    updatedAtUTC: formatUtc()
  };
  await fs.writeFile(statusPath, JSON.stringify(updatedStatus, null, 2), "utf8");

  const summary = {
    recordId,
    templateUsed: TEMPLATE_PATH,
    sourcesCount: currentPayload.sources.length,
    imageSelected: Boolean(image),
    status: "draft",
    warnings: [...sourceWarnings, ...imageWarnings],
    docStatusPrevious: docStatus,
    issuerVerification,
    recoveryTrace: currentPayload.recoveryTrace ?? null
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`[build-document-b] Falha: ${(error as Error).message}`);
  process.exitCode = 1;
});

