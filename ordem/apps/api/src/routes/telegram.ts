import { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateInitData } from "../lib/telegram.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { loadEnv } from "../config.js";

const env = loadEnv();

const AuthRequestSchema = z.object({
  initData: z.string().min(1)
});

const replayCache = new Map<string, number>();
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export async function telegramRoutes(app: FastifyInstance) {
  app.post("/telegram/webapp/auth", async (request, reply) => {
    if ((request.body as any)?.initDataUnsafe) {
      return reply.status(400).send({ message: "initDataUnsafe is not allowed" });
    }
    const parsed = AuthRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid initData payload" });
    }

    const { user, dataHash } = validateInitData(
      parsed.data.initData,
      env.TELEGRAM_BOT_TOKEN,
      86400
    );

    const nowMs = Date.now();
    for (const [hash, ts] of replayCache.entries()) {
      if (nowMs - ts > REPLAY_WINDOW_MS) {
        replayCache.delete(hash);
      }
    }
    const lastSeen = replayCache.get(dataHash);
    if (lastSeen && nowMs - lastSeen < REPLAY_WINDOW_MS) {
      return reply.status(401).send({ message: "initData replay detected" });
    }
    replayCache.set(dataHash, nowMs);

    const now = Date.now();

    const existing = db
      .select()
      .from(users)
      .where(eq(users.telegramId, user.id))
      .get();

    let localUserId: number;

    if (existing) {
      db.update(users)
        .set({
          username: user.username || existing.username,
          firstName: user.first_name || existing.firstName,
          updatedAt: now
        })
        .where(eq(users.id, existing.id))
        .run();
      localUserId = existing.id;
    } else {
      const insert = db
        .insert(users)
        .values({
          telegramId: user.id,
          username: user.username || null,
          firstName: user.first_name || "Telegram",
          createdAt: now,
          updatedAt: now
        })
        .run();
      localUserId = Number(insert.lastInsertRowid);
    }

    const token = app.jwt.sign(
      {
        userId: localUserId,
        telegramId: user.id,
        username: user.username || null
      },
      { expiresIn: "12h" }
    );

    reply
      .setCookie("ordem_token", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 12
      })
      .send({
        token,
        user: {
          id: localUserId,
          telegramId: user.id,
          username: user.username || null,
          firstName: user.first_name || "Telegram"
        }
      });
  });
}
