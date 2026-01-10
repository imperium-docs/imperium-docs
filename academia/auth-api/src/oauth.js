import { createHash, randomBytes } from "node:crypto";
import { decodeJwt, SignJWT, importPKCS8 } from "jose";

const base64Url = (buffer) => {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

export const createState = () => base64Url(randomBytes(16));

export const createCodeVerifier = () => base64Url(randomBytes(32));

export const createCodeChallenge = (verifier) => {
  const hash = createHash("sha256").update(verifier).digest();
  return base64Url(hash);
};

export const providerSupportsPkce = (provider) => {
  return provider === "google" || provider === "meta" || provider === "apple";
};

const assertProviderEnabled = (provider, config) => {
  const details = config.providers[provider];
  if (!details) {
    throw new Error("Provider not supported");
  }

  if (provider === "apple") {
    if (!details.clientId || !details.teamId || !details.keyId || !details.privateKey) {
      throw new Error("Apple provider not configured");
    }
    return;
  }

  if (!details.clientId || !details.clientSecret) {
    throw new Error("Provider not configured");
  }
};

export const buildAuthUrl = (provider, config, { state, codeChallenge }) => {
  assertProviderEnabled(provider, config);
  const details = config.providers[provider];

  switch (provider) {
    case "google": {
      const params = new URLSearchParams({
        client_id: details.clientId,
        redirect_uri: details.redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: codeChallenge ?? "",
        code_challenge_method: "S256",
        access_type: "offline",
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }
    case "github": {
      const params = new URLSearchParams({
        client_id: details.clientId,
        redirect_uri: details.redirectUri,
        response_type: "code",
        scope: "read:user user:email",
        state,
      });
      return `https://github.com/login/oauth/authorize?${params.toString()}`;
    }
    case "meta": {
      const params = new URLSearchParams({
        client_id: details.clientId,
        redirect_uri: details.redirectUri,
        response_type: "code",
        scope: "public_profile,email",
        state,
        code_challenge: codeChallenge ?? "",
        code_challenge_method: "S256",
      });
      return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
    }
    case "apple": {
      const params = new URLSearchParams({
        client_id: details.clientId,
        redirect_uri: details.redirectUri,
        response_type: "code",
        response_mode: "form_post",
        scope: "name email",
        state,
        code_challenge: codeChallenge ?? "",
        code_challenge_method: "S256",
      });
      return `https://appleid.apple.com/auth/authorize?${params.toString()}`;
    }
    default:
      throw new Error("Provider not supported");
  }
};

const buildAppleClientSecret = async (details) => {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: details.teamId,
    iat: now,
    exp: now + 60 * 60,
    aud: "https://appleid.apple.com",
    sub: details.clientId,
  };
  const privateKey = await importPKCS8(details.privateKey, "ES256");
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "ES256", kid: details.keyId })
    .sign(privateKey);
};

const ensureOk = async (response, label) => {
  if (response.ok) return;
  const text = await response.text();
  const error = new Error(`${label} failed with ${response.status}`);
  error.details = text;
  throw error;
};

export const exchangeCodeForProfile = async (
  provider,
  config,
  { code, codeVerifier, fetcher, appleUser }
) => {
  assertProviderEnabled(provider, config);
  const details = config.providers[provider];
  const fetchFn = fetcher ?? fetch;

  switch (provider) {
    case "google": {
      const tokenResponse = await fetchFn(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: details.clientId,
            client_secret: details.clientSecret,
            code,
            code_verifier: codeVerifier ?? "",
            redirect_uri: details.redirectUri,
            grant_type: "authorization_code",
          }),
        }
      );
      await ensureOk(tokenResponse, "Google token");
      const tokenData = await tokenResponse.json();
      const userResponse = await fetchFn(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        }
      );
      await ensureOk(userResponse, "Google userinfo");
      const profile = await userResponse.json();
      return {
        providerAccountId: profile.sub,
        email: profile.email ?? null,
        name: profile.name ?? profile.given_name ?? null,
        avatar: profile.picture ?? null,
      };
    }
    case "github": {
      const tokenResponse = await fetchFn(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: details.clientId,
            client_secret: details.clientSecret,
            code,
            redirect_uri: details.redirectUri,
          }),
        }
      );
      await ensureOk(tokenResponse, "GitHub token");
      const tokenData = await tokenResponse.json();
      const token = tokenData.access_token;
      const userResponse = await fetchFn("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "academia-auth",
        },
      });
      await ensureOk(userResponse, "GitHub userinfo");
      const profile = await userResponse.json();

      let email = profile.email ?? null;
      if (!email) {
        const emailResponse = await fetchFn(
          "https://api.github.com/user/emails",
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "User-Agent": "academia-auth",
            },
          }
        );
        if (emailResponse.ok) {
          const emails = await emailResponse.json();
          const primary =
            emails.find((item) => item.primary && item.verified) ??
            emails.find((item) => item.verified) ??
            emails[0];
          email = primary?.email ?? null;
        }
      }

      return {
        providerAccountId: String(profile.id),
        email,
        name: profile.name ?? profile.login ?? null,
        avatar: profile.avatar_url ?? null,
      };
    }
    case "meta": {
      const tokenResponse = await fetchFn(
        "https://graph.facebook.com/v19.0/oauth/access_token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: details.clientId,
            client_secret: details.clientSecret,
            code,
            redirect_uri: details.redirectUri,
          }),
        }
      );
      await ensureOk(tokenResponse, "Meta token");
      const tokenData = await tokenResponse.json();
      const userResponse = await fetchFn(
        `https://graph.facebook.com/me?fields=id,name,email,picture.width(200).height(200)&access_token=${tokenData.access_token}`
      );
      await ensureOk(userResponse, "Meta userinfo");
      const profile = await userResponse.json();
      return {
        providerAccountId: profile.id,
        email: profile.email ?? null,
        name: profile.name ?? null,
        avatar: profile.picture?.data?.url ?? null,
      };
    }
    case "apple": {
      const clientSecret = await buildAppleClientSecret(details);
      const tokenResponse = await fetchFn("https://appleid.apple.com/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: details.clientId,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: details.redirectUri,
          code_verifier: codeVerifier ?? "",
        }),
      });
      await ensureOk(tokenResponse, "Apple token");
      const tokenData = await tokenResponse.json();
      const claims = decodeJwt(tokenData.id_token);
      const parsedUser = appleUser ? JSON.parse(appleUser) : null;
      const name = parsedUser?.name
        ? `${parsedUser.name.firstName ?? ""} ${parsedUser.name.lastName ?? ""}`.trim()
        : null;

      return {
        providerAccountId: claims.sub,
        email: claims.email ?? null,
        name: name || claims.name || null,
        avatar: null,
      };
    }
    default:
      throw new Error("Provider not supported");
  }
};

