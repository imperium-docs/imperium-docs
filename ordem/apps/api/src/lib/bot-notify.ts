import { loadEnv } from "../config.js";

const env = loadEnv();

export function buildStartAppLink(payload: string): string | null {
  if (!env.TELEGRAM_BOT_USERNAME || !env.TELEGRAM_APP_SHORT_NAME) return null;
  return `https://t.me/${env.TELEGRAM_BOT_USERNAME}/${env.TELEGRAM_APP_SHORT_NAME}?startapp=${payload}`;
}

export async function sendRequestNotification(
  telegramId: number,
  requestId: number
) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const link = buildStartAppLink(`req_${requestId}`);
  const text = link
    ? `You received a conversation request. Open Ordem: ${link}`
    : "You received a conversation request. Open Ordem from the bot menu.";

  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramId,
        text
      })
    });
  } catch {
    return;
  }
}
