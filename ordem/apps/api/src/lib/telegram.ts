import crypto from "node:crypto";

export type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
};

export type InitDataResult = {
  user: TelegramUser;
  authDate: number;
  dataHash: string;
};

export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number
): InitDataResult {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("Missing hash in initData");
  params.delete("hash");

  const sorted = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = crypto.createHash("sha256").update(botToken).digest();
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(sorted)
    .digest("hex");

  const hashBuffer = Buffer.from(hash, "hex");
  const hmacBuffer = Buffer.from(hmac, "hex");
  if (
    hashBuffer.length !== hmacBuffer.length ||
    !crypto.timingSafeEqual(hashBuffer, hmacBuffer)
  ) {
    throw new Error("Invalid initData signature");
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) {
    throw new Error("Invalid auth_date");
  }
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAgeSeconds) {
    throw new Error("initData expired");
  }

  const userRaw = params.get("user");
  if (!userRaw) throw new Error("Missing user payload");
  const user = JSON.parse(userRaw) as TelegramUser;
  if (!user?.id) throw new Error("Invalid user payload");

  return { user, authDate, dataHash: hash };
}
