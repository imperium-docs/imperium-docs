import {
  integer,
  sqliteTable,
  text,
  index
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  telegramId: integer("telegram_id").notNull().unique(),
  username: text("username"),
  firstName: text("first_name"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const conversationRequests = sqliteTable(
  "conversation_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fromUserId: integer("from_user_id").notNull(),
    toUserId: integer("to_user_id").notNull(),
    message: text("message").notNull(),
    status: text("status").notNull(),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at")
  },
  (table) => ({
    fromToStatus: index("idx_requests_from_to_status").on(
      table.fromUserId,
      table.toUserId,
      table.status
    )
  })
);

export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userAId: integer("user_a_id").notNull(),
  userBId: integer("user_b_id").notNull(),
  createdAt: integer("created_at").notNull(),
  lastMessageAt: integer("last_message_at").notNull()
});

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id").notNull(),
    senderUserId: integer("sender_user_id").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (table) => ({
    convCreated: index("idx_messages_conversation_created").on(
      table.conversationId,
      table.createdAt
    )
  })
);
