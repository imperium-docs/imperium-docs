import { loadEnv } from "../config.js";
import { runAggregateWithLock } from "./aggregates.js";
import { resolveDefaultWorkspaceId } from "./workspace.js";

export function startAnalyticsScheduler() {
  const env = loadEnv();
  if (!env.ANALYTICS_SCHEDULER_ENABLED) return;
  const intervalMs = 15 * 60 * 1000;
  const run = async () => {
    const workspaceId = await resolveDefaultWorkspaceId();
    if (!workspaceId) return;
    await runAggregateWithLock(workspaceId);
  };
  run().catch(() => null);
  setInterval(() => {
    run().catch(() => null);
  }, intervalMs);
}
