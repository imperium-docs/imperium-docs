import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import { telegramRoutes } from "./routes/telegram";
import { ordemRoutes } from "./routes/ordem";
import { devRoutes } from "./routes/dev";
import { loadEnv } from "./config";
import { runMigrations } from "./db";

export async function buildServer() {
  const env = loadEnv();
  const app = Fastify({ logger: true });

  app.register(cookie);
  app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: "ordem_token",
      signed: false
    }
  });

  const allowedOrigins = [env.ORDEM_WEB_ORIGIN, env.TELEGRAM_WEBAPP_URL]
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value as string).origin;
      } catch {
        return value as string;
      }
    });

  app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (!allowedOrigins.length || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      cb(new Error("Not allowed"), false);
    },
    credentials: true
  });

  runMigrations();

  app.register(telegramRoutes);

  app.register(
    async (scope) => {
      scope.addHook("preHandler", async (request, reply) => {
        const tokenFromCookie = request.cookies?.ordem_token;
        const authHeader = request.headers.authorization || "";
        const isDev = env.NODE_ENV === "development";
        let token = tokenFromCookie;

        if (!token && isDev && authHeader.startsWith("Bearer ")) {
          token = authHeader.slice("Bearer ".length);
        }

        if (!token) {
          return reply.status(401).send({ message: "Unauthorized" });
        }

        await request.jwtVerify({ token });
      });
      scope.register(ordemRoutes);
    },
    { prefix: "/ordem" }
  );

  if (env.NODE_ENV === "development") {
    app.register(devRoutes);
  }

  return app;
}
