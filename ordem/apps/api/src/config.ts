import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_APP_SHORT_NAME: z.string().optional(),
  TELEGRAM_WEBAPP_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(10),
  ORDEM_DB_PATH: z.string().default("./ordem.db"),
  ORDEM_WEB_ORIGIN: z.string().optional(),
  ADMIN_WEB_ORIGIN: z.string().optional(),
  ADMIN_JWT_SECRET: z
    .string()
    .min(16)
    .default("imperium-admin-dev-secret-change"),
  ANALYTICS_DATABASE_URL: z
    .string()
    .min(10)
    .default("postgres://postgres:postgres@localhost:5432/imperium"),
  ANALYTICS_POOL_MAX: z.coerce.number().default(10),
  ANALYTICS_DEFAULT_WORKSPACE_ID: z.string().uuid().optional(),
  ANALYTICS_EXPORTS_PATH: z.string().default("./exports"),
  ANALYTICS_SCHEDULER_ENABLED: z.coerce.boolean().default(true),
  ANALYTICS_MIGRATE_ON_BOOT: z.coerce.boolean().default(true),
  STORAGE_PROVIDER: z.enum(["local", "s3", "r2"]).default("local"),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_REGION: z.string().optional(),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional()
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issue = parsed.error.issues.map((item) => item.message).join(", ");
    throw new Error(`Invalid env: ${issue}`);
  }
  if (
    parsed.data.NODE_ENV === "production" &&
    parsed.data.ADMIN_JWT_SECRET === "imperium-admin-dev-secret-change"
  ) {
    throw new Error("ADMIN_JWT_SECRET must be overridden in production.");
  }
  return parsed.data;
}
