import { analyticsQuery } from "./db.js";
import { loadEnv } from "../config.js";

let cachedWorkspaceId: string | null = null;

export async function resolveDefaultWorkspaceId() {
  const env = loadEnv();
  if (env.ANALYTICS_DEFAULT_WORKSPACE_ID) {
    return env.ANALYTICS_DEFAULT_WORKSPACE_ID;
  }
  if (cachedWorkspaceId) return cachedWorkspaceId;
  const rows = await analyticsQuery<{ id: string }>(
    "SELECT id FROM workspaces WHERE name = $1 ORDER BY created_at LIMIT 1",
    ["Imperium"]
  );
  cachedWorkspaceId = rows[0]?.id ?? null;
  return cachedWorkspaceId;
}
