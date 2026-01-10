import { jwtVerify, SignJWT } from "jose";
import { loadEnv } from "../config.js";

export type AdminTokenPayload = {
  sub: string;
  email: string;
  role: "admin" | "analyst" | "support";
  workspaceId: string;
};

function getSecret() {
  const env = loadEnv();
  return new TextEncoder().encode(env.ADMIN_JWT_SECRET);
}

export async function signAdminToken(payload: AdminTokenPayload) {
  return new SignJWT({
    email: payload.email,
    role: payload.role,
    workspaceId: payload.workspaceId
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(getSecret());
}

export async function verifyAdminToken(token: string): Promise<AdminTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  return {
    sub: payload.sub as string,
    email: payload.email as string,
    role: payload.role as AdminTokenPayload["role"],
    workspaceId: payload.workspaceId as string
  };
}
