import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { databaseConfigured, prisma } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.redirect_uris) || body.redirect_uris.length < 1 || body.redirect_uris.length > 10) {
    return NextResponse.json({ error: "redirect_uris must be an array with 1–10 redirect URIs." }, { status: 400 });
  }
  const redirects: string[] = [];
  for (const value of body.redirect_uris) {
    if (typeof value !== "string" || value.length > 2000) return NextResponse.json({ error: "Invalid redirect URI." }, { status: 400 });
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new Error("https required");
      if (url.username || url.password || url.hash) throw new Error("invalid URI components");
      redirects.push(url.toString());
    } catch {
      return NextResponse.json({ error: "Each redirect URI must be an absolute HTTPS URI (localhost is allowed for development)." }, { status: 400 });
    }
  }
  const id = "hunt_" + randomBytes(24).toString("base64url");
  const client = await prisma.oAuthClient.create({
    data: {
      id,
      name: typeof body.client_name === "string" ? body.client_name.slice(0, 120) : "MCP Client",
      redirectUris: redirects,
      grantTypes: ["authorization_code", "refresh_token"],
      tokenEndpointAuthMethod: "none",
    },
  });
  return NextResponse.json({
    client_id: client.id,
    client_name: client.name,
    redirect_uris: redirects,
    grant_types: client.grantTypes,
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }, { status: 201, headers: { "cache-control": "no-store" } });
}
