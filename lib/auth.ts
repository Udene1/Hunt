import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";

const COOKIE = "hunt_session";
const ADMIN_COOKIE = "hunt_admin_session";
const SESSION_DAYS = 30;

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + derived;
}

function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && timingSafeEqual(actual, expectedBuffer);
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function issueSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  return prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } }).then(() => ({ token, expiresAt }));
}

export async function createUserSession(userId: string) {
  const session = await issueSession(userId);
  cookies().set(COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  return session;
}

export async function getCurrentUser() {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { profile: true } } },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    cookies().delete(COOKIE);
    return null;
  }
  return session.user;
}

export async function destroyCurrentSession() {
  const token = cookies().get(COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  cookies().delete(COOKIE);
}

export { hashPassword, verifyPassword };

export async function getBearerUser(request: Request) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const access = await prisma.accessToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { profile: true } } },
  });
  if (!access || access.revokedAt) return null;
  if (access.user.plan === "pilot" && (!access.user.pilotExpiresAt || access.user.pilotExpiresAt <= new Date())) return null;
  await prisma.accessToken.update({ where: { id: access.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return access.user;
}

export async function getAdminBearer(request: Request) {
  const header = request.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const token = bearer || request.headers.get("x-hunt-admin-session") || (request.headers.get("cookie") || "").match(/(?:^|;\\s*)hunt_admin_session=([^;]+)/)?.[1] || "";

  if (!token) return null;
  const access = await prisma.adminAccessToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!access || access.revokedAt) return null;
  await prisma.adminAccessToken.update({
    where: { id: access.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});
  return access;
}
