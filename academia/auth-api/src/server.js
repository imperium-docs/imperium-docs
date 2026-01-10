import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { config as baseConfig } from "./config.js";
import { createDatabase } from "./db.js";
import {
  buildAuthUrl,
  createCodeChallenge,
  createCodeVerifier,
  createState,
  exchangeCodeForProfile as defaultExchange,
  providerSupportsPkce,
} from "./oauth.js";

export const buildServer = async ({
  configOverrides = {},
  exchangeCodeForProfile = defaultExchange,
} = {}) => {
  const config = {
    ...baseConfig,
    ...configOverrides,
    providers: {
      ...baseConfig.providers,
      ...(configOverrides.providers ?? {}),
    },
  };

  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || config.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed"), false);
    },
    credentials: true,
  });

  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET,
  });

  await app.register(formbody);
  await app.register(rateLimit, {
    max: 60,
    timeWindow: "1 minute",
  });

  const db = createDatabase(config.databasePath);
  app.decorate("db", db);

  const cookieOptions = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
  };

  const stateCookieName = (provider) => `oauth_state_${provider}`;
  const verifierCookieName = (provider) => `oauth_verifier_${provider}`;

  const redirectToFront = (reply, path = "/") => {
    const base = config.frontendBaseUrl.replace(/\/$/, "");
    const target = `${base}${path}`;
    return reply.redirect(target);
  };

  const recordOauthError = (provider, error, request) => {
    request.log.error(
      { provider, message: error?.message ?? String(error) },
      "oauth_error",
    );
    db.recordEvent("oauth_error", provider);
  };

  const ensureUserForProfile = ({ provider, profile }) => {
    const { providerAccountId, email, name, avatar } = profile;
    const normalizedEmail = email ? email.toLowerCase() : null;
    const existingProvider = db.findProvider(provider, providerAccountId);

    if (existingProvider) {
      db.upsertProvider({
        userId: existingProvider.user_id,
        provider,
        providerAccountId,
        email: normalizedEmail,
        name,
        avatar,
      });
      db.updateUserLogin({
        id: existingProvider.user_id,
        name,
        avatar,
      });
      return { userId: existingProvider.user_id, pendingToken: null };
    }

    if (!normalizedEmail) {
      const pendingToken = db.createPendingEmail({
        provider,
        providerAccountId,
        name,
        avatar,
      });
      return { userId: null, pendingToken };
    }

    const existingUser = db.findUserByEmail(normalizedEmail);
    const user = existingUser ??
      db.createUser({
        email: normalizedEmail,
        name,
        avatar,
      });

    db.updateUserLogin({
      id: user.id,
      name,
      avatar,
    });

    db.upsertProvider({
      userId: user.id,
      provider,
      providerAccountId,
      email: normalizedEmail,
      name,
      avatar,
    });

    return { userId: user.id, pendingToken: null };
  };

  app.get("/health", async () => {
    return { ok: true };
  });

  app.get("/auth/:provider", async (request, reply) => {
    const provider = request.params.provider;
    try {
      const state = createState();
      const usePkce = providerSupportsPkce(provider);
      const codeVerifier = usePkce ? createCodeVerifier() : null;
      const codeChallenge = usePkce && codeVerifier
        ? createCodeChallenge(codeVerifier)
        : null;
      const authUrl = buildAuthUrl(provider, config, { state, codeChallenge });

      reply.setCookie(stateCookieName(provider), state, {
        ...cookieOptions,
        maxAge: 60 * 10,
      });
      if (codeVerifier) {
        reply.setCookie(verifierCookieName(provider), codeVerifier, {
          ...cookieOptions,
          maxAge: 60 * 10,
        });
      }

      return reply.redirect(authUrl);
    } catch (error) {
      recordOauthError(provider, error, request);
      return reply.code(400).send({ error: "provider_not_configured" });
    }
  });

  const handleCallback = async (request, reply) => {
    const provider = request.params.provider;
    const payload = request.method === "POST" ? request.body : request.query;
    const errorParam = payload?.error;
    if (errorParam) {
      recordOauthError(provider, new Error(String(errorParam)), request);
      return redirectToFront(reply, "/?auth=error");
    }

    const code = payload?.code;
    const state = payload?.state;

    if (!code || !state) {
      recordOauthError(provider, new Error("missing_code_or_state"), request);
      return redirectToFront(reply, "/?auth=error");
    }

    const expectedState = request.cookies[stateCookieName(provider)];
    const codeVerifier = request.cookies[verifierCookieName(provider)];

    reply.clearCookie(stateCookieName(provider), cookieOptions);
    reply.clearCookie(verifierCookieName(provider), cookieOptions);

    if (!expectedState || expectedState !== state) {
      recordOauthError(provider, new Error("invalid_state"), request);
      return redirectToFront(reply, "/?auth=error");
    }

    try {
      const profile = await exchangeCodeForProfile(provider, config, {
        code,
        codeVerifier,
        appleUser: payload?.user,
      });

      if (!profile?.providerAccountId) {
        throw new Error("missing_provider_account_id");
      }

      const result = ensureUserForProfile({ provider, profile });

      if (result.pendingToken) {
        return redirectToFront(
          reply,
          `/?collect-email=${encodeURIComponent(result.pendingToken)}`,
        );
      }

      db.recordEvent("oauth_success", provider);
      return redirectToFront(reply, "/?auth=success");
    } catch (error) {
      recordOauthError(provider, error, request);
      return redirectToFront(reply, "/?auth=error");
    }
  };

  app.get("/auth/:provider/callback", handleCallback);
  app.post("/auth/:provider/callback", handleCallback);

  app.post("/auth/collect-email", async (request, reply) => {
    const schema = z.object({
      token: z.string().min(1),
      email: z.string().email(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Dados invalidos." });
    }

    const { token, email } = parsed.data;
    const record = db.consumePendingEmail(token);
    if (!record) {
      return reply.code(400).send({ message: "Token expirado ou invalido." });
    }

    const normalizedEmail = email.toLowerCase();
    const existingUser = db.findUserByEmail(normalizedEmail);
    const user = existingUser ??
      db.createUser({
        email: normalizedEmail,
        name: record.name ?? null,
        avatar: record.avatar ?? null,
      });

    db.updateUserLogin({
      id: user.id,
      name: record.name ?? null,
      avatar: record.avatar ?? null,
    });

    db.upsertProvider({
      userId: user.id,
      provider: record.provider,
      providerAccountId: record.provider_account_id,
      email: normalizedEmail,
      name: record.name ?? null,
      avatar: record.avatar ?? null,
    });

    db.recordEvent("oauth_success", record.provider);

    return reply.send({ redirectUrl: `${config.frontendBaseUrl}/?auth=success` });
  });

  app.post("/analytics/event", async (request, reply) => {
    const schema = z.object({
      event: z.enum([
        "login_view",
        "oauth_click",
        "oauth_success",
        "oauth_error",
      ]),
      provider: z.string().optional(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Dados invalidos." });
    }

    const { event, provider } = parsed.data;
    db.recordEvent(event, provider ?? null);
    return reply.send({ ok: true });
  });

  app.get("/analytics/providers", async () => {
    const providers = db.getProviderStats();
    return { providers };
  });

  return app;
};

