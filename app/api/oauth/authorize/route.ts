import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser, hashToken } from "../../../../lib/auth";
import { databaseConfigured, prisma } from "../../../../lib/db";
import { monitoringEntitled } from "../../../../lib/entitlements";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to Hunt before authorizing." }, { status: 401 });
  if (!monitoringEntitled(user)) return NextResponse.json({ error: "Hunt MCP requires active pilot or paid access. Activate access in your Hunt account first." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const clientId = typeof body?.client_id === "string" ? body.client_id : "";
  const redirectUri = typeof body?.redirect_uri === "string" ? body.redirect_uri : "";
  const challenge = typeof body?.code_challenge === "string" ? body.code_challenge : "";
  const state = typeof body?.state === "string" ? body.state : "";
  const responseType = typeof body?.response_type === "string" ? body.response_type : "";
  const method = typeof body?.code_challenge_method === "string" ? body.code_challenge_method : "";
  const scope = typeof body?.scope === "string" ? body.scope : "hunt:read";
  if (responseType !== "code" || method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || !state || state.length > 1000 || scope.split(/\s+/).some((s: string) => s && s !== "hunt:read")) {
    return NextResponse.json({ error: "Invalid OAuth authorization request. PKCE S256 and the hunt:read scope are required." }, { status: 400 });
  }
  const client = await prisma.oAuthClient.findUnique({ where: { id: clientId } });
  if (!client || !(client.redirectUris as string[]).includes(redirectUri)) return NextResponse.json({ error: "Unknown client or redirect URI mismatch." }, { status: 400 });
  const code = randomBytes(32).toString("base64url");
  await prisma.oAuthAuthorizationCode.create({
    data: {
      codeHash: hashToken(code),
      clientId,
      userId: user.id,
      redirectUri,
      codeChallenge: challenge,
      scope: "hunt:read",
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
  });
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", state);
  return NextResponse.json({ redirect_to: redirect.toString() }, { headers: { "cache-control": "no-store" } });
}
