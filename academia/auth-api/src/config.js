import { readFileSync } from "node:fs";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  PORT: z.string().optional(),
  HOST: z.string().optional(),
  PUBLIC_BASE_URL: z.string().optional(),
  FRONTEND_BASE_URL: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  DATABASE_PATH: z.string().optional(),
  COOKIE_SECURE: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_REDIRECT_URI: z.string().optional(),
  META_CLIENT_ID: z.string().optional(),
  META_CLIENT_SECRET: z.string().optional(),
  META_REDIRECT_URI: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  APPLE_PRIVATE_KEY_FILE: z.string().optional(),
  APPLE_REDIRECT_URI: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
});

const env = envSchema.parse(process.env);

const port = env.PORT ? Number(env.PORT) : 8787;
const host = env.HOST ?? "0.0.0.0";
const publicBaseUrl = env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
const frontendBaseUrl = env.FRONTEND_BASE_URL ?? "http://localhost:5173";
const allowedOrigins = (env.ALLOWED_ORIGINS ?? frontendBaseUrl)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const databasePath = env.DATABASE_PATH ?? "./data/auth.db";
const cookieSecure = env.COOKIE_SECURE === "true";

const readApplePrivateKey = () => {
  if (env.APPLE_PRIVATE_KEY) {
    return env.APPLE_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  if (env.APPLE_PRIVATE_KEY_FILE) {
    return readFileSync(env.APPLE_PRIVATE_KEY_FILE, "utf8");
  }
  return undefined;
};

export const config = {
  port,
  host,
  publicBaseUrl,
  frontendBaseUrl,
  allowedOrigins,
  databasePath,
  cookieSecure,
  logLevel: env.LOG_LEVEL ?? "info",
  providers: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
      redirectUri:
        env.GOOGLE_REDIRECT_URI ?? `${publicBaseUrl}/auth/google/callback`,
    },
    github: {
      clientId: env.GITHUB_CLIENT_ID ?? "",
      clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
      redirectUri:
        env.GITHUB_REDIRECT_URI ?? `${publicBaseUrl}/auth/github/callback`,
    },
    meta: {
      clientId: env.META_CLIENT_ID ?? "",
      clientSecret: env.META_CLIENT_SECRET ?? "",
      redirectUri:
        env.META_REDIRECT_URI ?? `${publicBaseUrl}/auth/meta/callback`,
    },
    apple: {
      clientId: env.APPLE_CLIENT_ID ?? "",
      teamId: env.APPLE_TEAM_ID ?? "",
      keyId: env.APPLE_KEY_ID ?? "",
      privateKey: readApplePrivateKey() ?? "",
      redirectUri:
        env.APPLE_REDIRECT_URI ?? `${publicBaseUrl}/auth/apple/callback`,
    },
  },
};

