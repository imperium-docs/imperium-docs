import fs from "node:fs/promises";
import path from "node:path";
import { buildIssuerAliases, matchIssuerSignals, resolveIssuerCandidate } from "./lib/issuer.ts";
import { parseSecCompanyFromHtml } from "./lib/sec-recovery.ts";

type FixtureSource = { tier: "primary" | "secondary"; url: string; html: string };
type Fixture = {
  name: string;
  title: string;
  entityGuess: { type: "company" | "person" | "unknown"; name: string };
  sources: FixtureSource[];
  recovery?: { secHtml: string; useTicker?: boolean };
  expect: { status: "ok" | "needs_review"; recoveryUsed?: boolean };
};

function evaluateIssuerVerification(sources: FixtureSource[], aliases: string[], tickers: string[]) {
  const evaluated = sources.map((source) => {
    const signals = matchIssuerSignals(source.html, aliases, tickers);
    return { ...source, signals };
  });
  const high = evaluated.filter(
    (entry) => entry.signals.confidence === "high" && entry.signals.matchedAlias
  );
  const primary = evaluated.find((entry) => entry.tier === "primary");
  const primaryHigh = primary
    ? primary.signals.confidence === "high" && Boolean(primary.signals.matchedAlias)
    : true;
  const passed = high.length >= 3 && primaryHigh;
  return { passed, highCount: high.length, primaryHigh };
}

async function loadFixtures(fixturesDir: string) {
  const entries = await fs.readdir(fixturesDir);
  const files = entries.filter((entry) => entry.endsWith(".json"));
  if (!files.length) {
    throw new Error("No issuer fixtures found.");
  }
  const fixtures: Fixture[] = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(fixturesDir, file), "utf8");
    fixtures.push(JSON.parse(raw) as Fixture);
  }
  return fixtures;
}

async function main() {
  const fixturesDir = path.join("fixtures", "issuer");
  const fixtures = await loadFixtures(fixturesDir);
  const results = [];
  const errors: string[] = [];

  for (const fixture of fixtures) {
    const issuerCandidate = resolveIssuerCandidate(fixture.title, fixture.entityGuess);
    const { aliases, tickers } = buildIssuerAliases(fixture.title, issuerCandidate);
    let verification = evaluateIssuerVerification(fixture.sources, aliases, tickers);
    let recoveryUsed = false;
    if (!verification.passed && fixture.recovery?.secHtml) {
      const recovered = parseSecCompanyFromHtml(fixture.recovery.secHtml);
      if (recovered) {
        if (fixture.recovery.useTicker && tickers.length === 0) {
          errors.push(`Fixture ${fixture.name} expected ticker recovery but no ticker found.`);
        }
        const recoveryAliases = buildIssuerAliases(fixture.title, recovered.name);
        verification = evaluateIssuerVerification(
          fixture.sources,
          recoveryAliases.aliases,
          recoveryAliases.tickers
        );
        recoveryUsed = true;
      }
    }
    const status = verification.passed ? "ok" : "needs_review";
    const ok = status === fixture.expect.status;
    if (!ok) {
      errors.push(`Fixture ${fixture.name} expected ${fixture.expect.status} but got ${status}`);
    }
    if (fixture.expect.recoveryUsed !== undefined && fixture.expect.recoveryUsed !== recoveryUsed) {
      errors.push(
        `Fixture ${fixture.name} expected recoveryUsed=${fixture.expect.recoveryUsed} but got ${recoveryUsed}`
      );
    }
    results.push({
      name: fixture.name,
      expected: fixture.expect.status,
      actual: status,
      verification,
      recoveryUsed
    });
  }

  const summary = {
    ok: errors.length === 0,
    fixtures: results,
    errors
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[test-issuer-guardrail] Falha: ${(error as Error).message}`);
  process.exitCode = 1;
});
