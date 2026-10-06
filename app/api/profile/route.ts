import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "../../../lib/auth";
import { databaseConfigured, prisma } from "../../../lib/db";

const jsonValue = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
};

export const dynamic = "force-dynamic";

export async function GET() {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
  return NextResponse.json({ profile });
}

export async function PUT(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid profile payload." }, { status: 400 });

  const profile = await prisma.userProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      profession: typeof body.profession === "string" ? body.profession.trim() || null : null,
      services: jsonValue(body.services),
      industries: jsonValue(body.industries),
      geography: typeof body.geography === "string" ? body.geography.trim() || null : null,
      idealCustomer: typeof body.idealCustomer === "string" ? body.idealCustomer.trim() || null : null,
      targetCompanies: jsonValue(body.targetCompanies),
      desiredSignals: jsonValue(body.desiredSignals),
      exclusions: jsonValue(body.exclusions),
      commercialObjectives: jsonValue(body.commercialObjectives),
    },
    update: {
      profession: typeof body.profession === "string" ? body.profession.trim() || null : null,
      services: jsonValue(body.services),
      industries: jsonValue(body.industries),
      geography: typeof body.geography === "string" ? body.geography.trim() || null : null,
      idealCustomer: typeof body.idealCustomer === "string" ? body.idealCustomer.trim() || null : null,
      targetCompanies: jsonValue(body.targetCompanies),
      desiredSignals: jsonValue(body.desiredSignals),
      exclusions: jsonValue(body.exclusions),
      commercialObjectives: jsonValue(body.commercialObjectives),
    },
  });

  return NextResponse.json({ profile });
}
