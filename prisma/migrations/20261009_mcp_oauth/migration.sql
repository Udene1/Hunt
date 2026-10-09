CREATE TABLE IF NOT EXISTS "hunt"."OAuthClient" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'MCP Client',
  "redirectUris" JSONB NOT NULL,
  "grantTypes" JSONB NOT NULL,
  "tokenEndpointAuthMethod" TEXT NOT NULL DEFAULT 'none',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "hunt"."OAuthAuthorizationCode" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "codeChallenge" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'hunt:read',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthAuthorizationCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthAuthorizationCode_codeHash_key" ON "hunt"."OAuthAuthorizationCode"("codeHash");
CREATE INDEX IF NOT EXISTS "OAuthAuthorizationCode_expiresAt_idx" ON "hunt"."OAuthAuthorizationCode"("expiresAt");
CREATE TABLE IF NOT EXISTS "hunt"."OAuthRefreshToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'hunt:read',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthRefreshToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthRefreshToken_tokenHash_key" ON "hunt"."OAuthRefreshToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "OAuthRefreshToken_userId_revokedAt_idx" ON "hunt"."OAuthRefreshToken"("userId","revokedAt");
CREATE INDEX IF NOT EXISTS "OAuthRefreshToken_expiresAt_idx" ON "hunt"."OAuthRefreshToken"("expiresAt");
DO $$ BEGIN
  ALTER TABLE "hunt"."OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "hunt"."OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hunt"."OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "hunt"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hunt"."OAuthRefreshToken" ADD CONSTRAINT "OAuthRefreshToken_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "hunt"."OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hunt"."OAuthRefreshToken" ADD CONSTRAINT "OAuthRefreshToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "hunt"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
