import { z } from "zod";

export const UserSchema = z.object({
  id: z.number(),
  telegramId: z.number(),
  username: z.string().nullable(),
  firstName: z.string()
});

export const ConversationSchema = z.object({
  id: z.number(),
  title: z.string(),
  lastMessageAt: z.number(),
  lastMessagePreview: z.string().optional()
});

export const MessageSchema = z.object({
  id: z.number(),
  conversationId: z.number(),
  senderUserId: z.number(),
  body: z.string(),
  createdAt: z.number()
});

export const ConversationRequestSchema = z.object({
  id: z.number(),
  from: UserSchema,
  message: z.string(),
  status: z.string(),
  createdAt: z.number()
});

export type User = z.infer<typeof UserSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ConversationRequest = z.infer<typeof ConversationRequestSchema>;
