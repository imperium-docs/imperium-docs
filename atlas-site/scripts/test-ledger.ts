import { spawn } from "node:child_process";
import path from "node:path";

type Slot = "morning" | "noon" | "night";

function parseArgs() {
  const args = process.argv.slice(2);
  const slotIdx = args.indexOf("--slot");
  const slot = slotIdx >= 0 ? (args[slotIdx + 1] as Slot | undefined) : undefined;
  const dateIdx = args.indexOf("--date");
  const date = dateIdx >= 0 ? args[dateIdx + 1] : undefined;
  const oldIdx = args.indexOf("--oldRecordId");
  const oldRecordId = oldIdx >= 0 ? args[oldIdx + 1] : undefined;
  const dateOldIdx = args.indexOf("--dateOld");
  const dateOld = dateOldIdx >= 0 ? args[dateOldIdx + 1] : undefined;
  const dateNewIdx = args.indexOf("--dateNew");
  const dateNew = dateNewIdx >= 0 ? args[dateNewIdx + 1] : undefined;
  return { slot, date, oldRecordId, dateOld, dateNew };
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

async function runScript(scriptPath: string, args: string[]) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ["-r", "ts-node/register", scriptPath, ...args], {
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const { slot, date, oldRecordId, dateOld, dateNew } = parseArgs();
  const rootDir = process.cwd();
  const errors: string[] = [];
  const resolvedSlot = slot ?? "morning";
  const resolvedDate = date ?? formatDateKey("America/Sao_Paulo");

  const verifyPath = path.join(rootDir, "scripts", "verify-pipeline.ts");
  const verifyCode = await runScript(verifyPath, ["--slot", resolvedSlot, "--date", resolvedDate]);
  if (verifyCode !== 0) {
    errors.push("verify_pipeline_failed");
  }

  if (!oldRecordId || !dateOld || !dateNew) {
    errors.push("fixture_args_missing");
    const summary = {
      ok: false,
      status: "failed",
      errors,
      message:
        "Provide --oldRecordId, --dateOld, and --dateNew to run the fixture supersede test."
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const fixturePath = path.join(rootDir, "scripts", "fixture-supersede-test.ts");
  const fixtureArgs = [
    "--oldRecordId",
    oldRecordId,
    "--slot",
    resolvedSlot,
    "--dateOld",
    dateOld,
    "--dateNew",
    dateNew
  ];
  const fixtureCode = await runScript(fixturePath, fixtureArgs);
  if (fixtureCode !== 0) {
    errors.push("fixture_supersede_failed");
  }

  const summary = {
    ok: errors.length === 0,
    status: errors.length === 0 ? "passed" : "failed",
    slot: resolvedSlot,
    date: resolvedDate,
    errors
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[test-ledger] Falha: ${(error as Error).message}`);
  process.exitCode = 1;
});
