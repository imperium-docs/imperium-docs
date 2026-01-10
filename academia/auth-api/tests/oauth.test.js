import test from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/server.js";

const getCookieMap = (cookies) => {
  return cookies.reduce((acc, cookie) => {
    acc[cookie.name] = cookie.value;
    return acc;
  }, {});
};

test("callback redirects to collect email when provider has no email", async () => {
  const app = await buildServer({
    configOverrides: {
      databasePath: ":memory:",
      frontendBaseUrl: "http://localhost:5173",
    },
    exchangeCodeForProfile: async () => ({
      providerAccountId: "meta-1",
      email: null,
      name: "No Email",
      avatar: null,
    }),
  });
  await app.ready();

  const start = await app.inject({ method: "GET", url: "/auth/meta" });
  const cookieMap = getCookieMap(start.cookies);

  const callback = await app.inject({
    method: "GET",
    url: `/auth/meta/callback?code=abc&state=${cookieMap.oauth_state_meta}`,
    cookies: cookieMap,
  });

  assert.equal(callback.statusCode, 302);
  assert.match(String(callback.headers.location), /collect-email=/);

  await app.close();
});

test("callback links providers by email", async () => {
  const app = await buildServer({
    configOverrides: {
      databasePath: ":memory:",
      frontendBaseUrl: "http://localhost:5173",
    },
    exchangeCodeForProfile: async (provider) => {
      if (provider === "google") {
        return {
          providerAccountId: "g-1",
          email: "link@imperium.dev",
          name: "Link User",
          avatar: null,
        };
      }
      return {
        providerAccountId: "gh-1",
        email: "link@imperium.dev",
        name: "Link User",
        avatar: null,
      };
    },
  });
  await app.ready();

  const startGoogle = await app.inject({ method: "GET", url: "/auth/google" });
  const googleCookies = getCookieMap(startGoogle.cookies);
  await app.inject({
    method: "GET",
    url: `/auth/google/callback?code=abc&state=${googleCookies.oauth_state_google}`,
    cookies: googleCookies,
  });

  const startGitHub = await app.inject({ method: "GET", url: "/auth/github" });
  const githubCookies = getCookieMap(startGitHub.cookies);
  await app.inject({
    method: "GET",
    url: `/auth/github/callback?code=abc&state=${githubCookies.oauth_state_github}`,
    cookies: githubCookies,
  });

  const userCount = app.db.db
    .prepare("SELECT COUNT(*) as count FROM users")
    .get().count;
  const providerCount = app.db.db
    .prepare("SELECT COUNT(*) as count FROM auth_providers")
    .get().count;
  const providerLinks = app.db.db
    .prepare("SELECT provider, user_id FROM auth_providers ORDER BY provider")
    .all();

  assert.equal(userCount, 1);
  assert.equal(providerCount, 2);
  assert.equal(providerLinks[0].user_id, providerLinks[1].user_id);

  await app.close();
});

