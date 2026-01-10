const forbiddenKeys = [
  "email",
  "e-mail",
  "phone",
  "telefone",
  "cpf",
  "rg",
  "address",
  "endereco",
  "first_name",
  "last_name",
  "nome",
  "full_name",
  "user_name"
];

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function scanValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    return emailPattern.test(value);
  }
  if (typeof value === "object") {
    return scanObject(value as Record<string, unknown>);
  }
  return false;
}

function scanObject(obj: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(obj)) {
    const normalizedKey = key.toLowerCase().replace(/\s+/g, "_");
    if (forbiddenKeys.includes(normalizedKey)) return true;
    if (scanValue(value)) return true;
  }
  return false;
}

export function hasPII(payload: Record<string, unknown> | null): boolean {
  if (!payload) return false;
  return scanObject(payload);
}
