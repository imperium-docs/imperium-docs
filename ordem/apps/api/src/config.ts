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
  ORDEM_WEB_ORIGIN: z.string().optional()
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issue = parsed.error.issues.map((item) => item.message).join(", ");
    throw new Error(`Invalid env: ${issue}`);
  }
  return parsed.data;
}
