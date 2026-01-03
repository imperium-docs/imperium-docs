import { FastifyInstance } from "fastify";
import { db } from "../db";
import { users } from "../db/schema";

export async function devRoutes(app: FastifyInstance) {
  app.post("/dev/mock-users", async () => {
    if (process.env.NODE_ENV !== "development") {
      return { ok: false };
    }
    const now = Date.now();
    db.insert(users)
      .values({
        telegramId: 111111,
        username: "mock_a",
        firstName: "Mock A",
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoNothing()
      .run();
    db.insert(users)
      .values({
        telegramId: 222222,
        username: "mock_b",
        firstName: "Mock B",
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoNothing()
      .run();
    return { ok: true };
  });
}
