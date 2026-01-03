import { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, gt, inArray, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  conversationRequests,
  conversations,
  messages,
  users
} from "../db/schema.js";
import { InMemoryRateLimiter, RateLimitResult } from "../lib/rate-limit.js";
import { sendRequestNotification } from "../lib/bot-notify.js";

const MAX_MESSAGE_LENGTH = 1000;
const MAX_REQUEST_LENGTH = 280;

type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type UserRow = typeof users.$inferSelect;
type RequestRow = typeof conversationRequests.$inferSelect;

const hasObviousSpam = (value: string) => {
  if (/(.)\1{6,}/.test(value)) return true;
  const urlMatches = value.match(/https?:\/\/\S+/gi) || [];
  return urlMatches.length > 5;
};

const CreateRequestSchema = z.object({
  to: z.string().min(1),
  message: z
    .string()
    .min(1)
    .max(MAX_REQUEST_LENGTH)
    .refine((value) => !hasObviousSpam(value), {
      message: "Request message rejected"
    })
});

const CreateMessageSchema = z.object({
  body: z
    .string()
    .min(1)
    .max(MAX_MESSAGE_LENGTH)
    .refine((value) => !hasObviousSpam(value), {
      message: "Message rejected"
    })
});

const requestLimiter = new InMemoryRateLimiter(5, 24 * 60 * 60 * 1000);
const messageLimiter = new InMemoryRateLimiter(30, 60 * 1000);

const rateLimitPayload = (rate: RateLimitResult) => ({
  code: "rate_limited",
  message: "Rate limit exceeded",
  resetAt: rate.resetAt
});

export async function ordemRoutes(app: FastifyInstance) {
  app.get("/me", async (request) => {
    const userId = request.user.userId;
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) throw new Error("User not found");
    return {
      id: user.id,
      telegramId: user.telegramId,
      username: user.username,
      firstName: user.firstName
    };
  });

  app.get("/conversations", async (request) => {
    const userId = request.user.userId;
    const convs = db
      .select()
      .from(conversations)
      .where(
        or(eq(conversations.userAId, userId), eq(conversations.userBId, userId))
      )
      .orderBy(desc(conversations.lastMessageAt))
      .all();

    if (!convs.length) return [];

    const counterpartIds = convs.map((conv: ConversationRow) =>
      conv.userAId === userId ? conv.userBId : conv.userAId
    );
    const counterpartUsers = db
      .select()
      .from(users)
      .where(inArray(users.id, counterpartIds))
      .all();

    const latestMessages = db
      .select()
      .from(messages)
      .where(
        inArray(
          messages.conversationId,
          convs.map((conv: ConversationRow) => conv.id)
        )
      )
      .orderBy(desc(messages.createdAt))
      .all();

    const latestMap = new Map<number, { body: string; createdAt: number }>();
    for (const msg of latestMessages) {
      if (!latestMap.has(msg.conversationId)) {
        latestMap.set(msg.conversationId, {
          body: msg.body,
          createdAt: msg.createdAt
        });
      }
    }

    return convs.map((conv: ConversationRow) => {
      const counterpart = counterpartUsers.find(
        (user: UserRow) =>
          user.id === (conv.userAId === userId ? conv.userBId : conv.userAId)
      );
      const preview = latestMap.get(conv.id);
      return {
        id: conv.id,
        title: counterpart?.username || counterpart?.firstName || "Unknown",
        lastMessageAt: conv.lastMessageAt,
        lastMessagePreview: preview?.body || ""
      };
    });
  });

  app.get("/conversations/:id/messages", async (request) => {
    const userId = request.user.userId;
    const params = z
      .object({ id: z.coerce.number() })
      .parse(request.params);
    const query = z
      .object({ after: z.string().optional(), limit: z.string().optional() })
      .parse(request.query);
    const conversation = db
      .select()
      .from(conversations)
      .where(eq(conversations.id, params.id))
      .get();

    if (!conversation) return [];
    if (![conversation.userAId, conversation.userBId].includes(userId)) {
      return [];
    }

    const afterRaw = query.after ? Number(query.after) : 0;
    const after = Number.isFinite(afterRaw) ? afterRaw : 0;
    const limit = Math.min(Number(query.limit || 50), 200);

    const conditions = [eq(messages.conversationId, params.id)];
    if (after) conditions.push(gt(messages.createdAt, after));

    const results = db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(messages.createdAt)
      .limit(limit)
      .all();

    return results.map((message: MessageRow) => ({
      id: message.id,
      conversationId: message.conversationId,
      senderUserId: message.senderUserId,
      body: message.body,
      createdAt: message.createdAt
    }));
  });

  app.post("/conversations/:id/messages", async (request, reply) => {
    const userId = request.user.userId;
    const params = z.object({ id: z.coerce.number() }).parse(request.params);
    const payload = CreateMessageSchema.parse(request.body);

    const rate = messageLimiter.consume(`message:${userId}`);
    if (!rate.ok) {
      return reply.status(429).send(rateLimitPayload(rate));
    }

    const conversation = db
      .select()
      .from(conversations)
      .where(eq(conversations.id, params.id))
      .get();

    if (!conversation) {
      return reply.status(404).send({ message: "Conversation not found" });
    }

    if (![conversation.userAId, conversation.userBId].includes(userId)) {
      return reply.status(403).send({ message: "Forbidden" });
    }

    const now = Date.now();
    const insert = db
      .insert(messages)
      .values({
        conversationId: params.id,
        senderUserId: userId,
        body: payload.body,
        createdAt: now
      })
      .run();

    db.update(conversations)
      .set({ lastMessageAt: now })
      .where(eq(conversations.id, params.id))
      .run();

    return {
      id: Number(insert.lastInsertRowid),
      conversationId: params.id,
      senderUserId: userId,
      body: payload.body,
      createdAt: now
    };
  });

  app.post("/requests", async (request, reply) => {
    const userId = request.user.userId;
    const payload = CreateRequestSchema.parse(request.body);

    const rate = requestLimiter.consume(`request:${userId}`);
    if (!rate.ok) {
      return reply.status(429).send(rateLimitPayload(rate));
    }

    const targetValue = payload.to.replace(/^@/, "");
    const target = Number.isFinite(Number(targetValue))
      ? db
          .select()
          .from(users)
          .where(eq(users.telegramId, Number(targetValue)))
          .get()
      : db.select().from(users).where(eq(users.username, targetValue)).get();

    if (!target) {
      return reply.status(404).send({ message: "Target user not found" });
    }
    if (target.id === userId) {
      return reply.status(400).send({ message: "Cannot request yourself" });
    }

    const existingRequest = db
      .select()
      .from(conversationRequests)
      .where(
        or(
          and(
            eq(conversationRequests.fromUserId, userId),
            eq(conversationRequests.toUserId, target.id),
            eq(conversationRequests.status, "pending")
          ),
          and(
            eq(conversationRequests.fromUserId, target.id),
            eq(conversationRequests.toUserId, userId),
            eq(conversationRequests.status, "pending")
          )
        )
      )
      .get();

    if (existingRequest) {
      return reply.status(409).send({ message: "Request already pending" });
    }

    const existingConversation = db
      .select()
      .from(conversations)
      .where(
        or(
          and(
            eq(conversations.userAId, userId),
            eq(conversations.userBId, target.id)
          ),
          and(
            eq(conversations.userAId, target.id),
            eq(conversations.userBId, userId)
          )
        )
      )
      .get();

    if (existingConversation) {
      return reply.status(409).send({ message: "Conversation already exists" });
    }

    const now = Date.now();
    const insert = db
      .insert(conversationRequests)
      .values({
        fromUserId: userId,
        toUserId: target.id,
        message: payload.message,
        status: "pending",
        createdAt: now
      })
      .run();

    const requestId = Number(insert.lastInsertRowid);
    sendRequestNotification(target.telegramId, requestId);

    return { id: requestId };
  });

  app.get("/requests/inbox", async (request) => {
    const userId = request.user.userId;
    const inbox = db
      .select()
      .from(conversationRequests)
      .where(
        and(
          eq(conversationRequests.toUserId, userId),
          eq(conversationRequests.status, "pending")
        )
      )
      .orderBy(desc(conversationRequests.createdAt))
      .all();

    if (!inbox.length) return [];

    const senderIds = inbox.map((req: RequestRow) => req.fromUserId);
    const senders = db
      .select()
      .from(users)
      .where(inArray(users.id, senderIds))
      .all();

    return inbox.map((req: RequestRow) => {
      const from = senders.find((user: UserRow) => user.id === req.fromUserId);
      return {
        id: req.id,
        from: {
          id: from?.id || req.fromUserId,
          telegramId: from?.telegramId || 0,
          username: from?.username || null,
          firstName: from?.firstName || "Unknown"
        },
        message: req.message,
        status: req.status,
        createdAt: req.createdAt
      };
    });
  });

  app.post("/requests/:id/accept", async (request, reply) => {
    const userId = request.user.userId;
    const params = z.object({ id: z.coerce.number() }).parse(request.params);
    const reqRow = db
      .select()
      .from(conversationRequests)
      .where(eq(conversationRequests.id, params.id))
      .get();

    if (!reqRow || reqRow.toUserId !== userId) {
      return reply.status(404).send({ message: "Request not found" });
    }
    if (reqRow.status !== "pending") {
      return reply.status(409).send({ message: "Request already handled" });
    }

    const now = Date.now();
    db.update(conversationRequests)
      .set({ status: "accepted", resolvedAt: now })
      .where(eq(conversationRequests.id, params.id))
      .run();

    const insert = db
      .insert(conversations)
      .values({
        userAId: reqRow.fromUserId,
        userBId: reqRow.toUserId,
        createdAt: now,
        lastMessageAt: now
      })
      .run();

    return { conversationId: Number(insert.lastInsertRowid) };
  });

  app.post("/requests/:id/reject", async (request, reply) => {
    const userId = request.user.userId;
    const params = z.object({ id: z.coerce.number() }).parse(request.params);
    const reqRow = db
      .select()
      .from(conversationRequests)
      .where(eq(conversationRequests.id, params.id))
      .get();

    if (!reqRow || reqRow.toUserId !== userId) {
      return reply.status(404).send({ message: "Request not found" });
    }

    if (reqRow.status !== "pending") {
      return reply.status(409).send({ message: "Request already handled" });
    }

    db.update(conversationRequests)
      .set({ status: "rejected", resolvedAt: Date.now() })
      .where(eq(conversationRequests.id, params.id))
      .run();

    return { ok: true };
  });
}
