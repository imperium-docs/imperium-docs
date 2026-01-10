import crypto from "node:crypto";

export function normalizeEmail(email: string | null): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

export function hashEmail(email: string): string {
  return crypto.createHash("sha256").update(email).digest("hex");
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}
