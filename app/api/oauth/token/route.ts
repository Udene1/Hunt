import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { hashToken } from "../../../../lib/auth";
import { databaseConfigured, prisma } from "../../../../lib/db";
import { monitoringEntitled } from "../../../../lib/entitlements";

export const dynamic = "force-dynamic";

function formError(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store", pragma: "no-cache" } });
}
function pkceMatches(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const actual = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function issueOpaqueToken() { return randomBytes(32).toString("base64url"); }

export async function POST(request: Request) {
  if (!databaseConfigured()) return formError("server_error", 503);
  const type = request.headers.get("content-type") || "";
  let params: URLSearchParams;
  if (type.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    params = new URLSearchParams(Object.entries(body).filter(([,v]) => typeof v === "string") as [string,string][]);
  } else {
    params = new URLSearchParams(await request.text());
  }
  const grantType = params.get("grant_type") || "";
  const clientId = params.get("client_id") || "";
  const client = await prisma.oAuthClient.findUnique({ where: { id: clientId } });
  if (!client || client.tokenEndpointAuthMethod !== "none") return formError("invalid_client", 401);

  if (grantType === "authorization_code") {
    const code = params.get("code") || "";
    const redirectUri = params.get("redirect_uri") || "";
    const verifier = params.get("code_verifier") || "";
    if (!code || !redirectUri || !verifier) return formError("invalid_request");
    const grant = await prisma.oAuthAuthorizationCode.findUnique({ where: { codeHash: hashToken(code) }, include: { user: true } });
    if (!grant || grant.clientId !== clientId || grant.redirectUri !== redirectUri || grant.usedAt || grant.expiresAt <= new Date() || !pkceMatches(verifier, grant.codeChallenge)) return formError("invalid_grant");
    const updated = await prisma.oAuthAuthorizationCode.updateMany({ where: { id: grant.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (updated.count !== 1) return formError("invalid_grant");
    if (!monitoringEntitled(grant.user)) return formError("access_denied", 403);
    const accessToken = issueOpaqueToken();
    const refreshToken = issueOpaqueToken();
    const accessExpires = new Date(Date.now() + 60 * 60_000);
    await prisma.accessToken.create({ data: { userId: grant.userId, tokenHash: hashToken(accessToken), label: "OAuth MCP", expiresAt: accessExpires } });
    await prisma.oAuthRefreshToken.create({ data: { tokenHash: hashToken(refreshToken), clientId, userId: grant.userId, scope: grant.scope, expiresAt: new Date(Date.now() + 30 * 86400_000) } });
    return NextResponse.json({ access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: refreshToken, scope: grant.scope }, { headers: { "cache-control": "no-store", pragma: "no-cache" } });
  }

  if (grantType === "refresh_token") {
    const raw = params.get("refresh_token") || "";
    if (!raw) return formError("invalid_request");
    const refresh = await prisma.oAuthRefreshToken.findUnique({ where: { tokenHash: hashToken(raw) }, include: { user: true } });
    if (!refresh || refresh.clientId !== clientId || refresh.revokedAt || refresh.expiresAt <= new Date()) return formError("invalid_grant");
    if (!monitoringEntitled(refresh.user)) return formError("access_denied", 403);
    const revoked = await prisma.oAuthRefreshToken.updateMany({ where: { id: refresh.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
    if (revoked.count !== 1) return formError("invalid_grant");
    const accessToken = issueOpaqueToken();
    const nextRefresh = issueOpaqueToken();
    const accessExpires = new Date(Date.now() + 60 * 60_000);
    await prisma.accessToken.create({ data: { userId: refresh.userId, tokenHash: hashToken(accessToken), label: "OAuth MCP", expiresAt: accessExpires } });
    await prisma.oAuthRefreshToken.create({ data: { tokenHash: hashToken(nextRefresh), clientId, userId: refresh.userId, scope: refresh.scope, expiresAt: new Date(Date.now() + 30 * 86400_000) } });
    return NextResponse.json({ access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: nextRefresh, scope: refresh.scope }, { headers: { "cache-control": "no-store", pragma: "no-cache" } });
  }
  return formError("unsupported_grant_type");
}
