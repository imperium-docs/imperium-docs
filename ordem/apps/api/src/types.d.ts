import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      userId: number;
      telegramId: number;
      username: string | null;
    };
    user: {
      userId: number;
      telegramId: number;
      username: string | null;
    };
  }
}

declare module "fastify" {
  interface FastifyRequest {
    adminUser?: {
      userId: string;
      email: string;
      role: "admin" | "analyst" | "support";
      workspaceId: string;
    };
  }
}
