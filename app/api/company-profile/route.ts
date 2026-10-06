import { NextResponse } from "next/server";
import { databaseConfigured, prisma } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const company = new URL(request.url).searchParams.get("company")?.trim();
  if (!company) return NextResponse.json({ error: "company is required." }, { status: 400 });
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  const record = await prisma.company.findFirst({
    where: { name: { equals: company, mode: "insensitive" } },
    select: {
      name: true, domain: true, country: true, generalSummary: true,
      contacts: { orderBy: { lastSeenAt: "desc" }, take: 30 },
      financialRecords: { orderBy: [{ publishedAt: "desc" }, { observedAt: "desc" }], take: 10 },
    },
  });
  if (!record) return NextResponse.json({ error: "Company not found." }, { status: 404 });
  return NextResponse.json({
    company: { name: record.name, domain: record.domain, country: record.country, summary: record.generalSummary },
    contacts: record.contacts,
    financials: record.financialRecords,
    provenanceRule: "Contacts and financial records are source-backed company context. Hunt does not infer private financial health from missing data.",
  });
}
