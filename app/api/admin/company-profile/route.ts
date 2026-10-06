import { NextResponse } from "next/server";
import { databaseConfigured, prisma } from "../../../../lib/db";
import { hashToken } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

async function authorize(request: Request) {
  if (!databaseConfigured() || !process.env.HUNT_ADMIN_SECRET) return NextResponse.json({ error: "Admin service not configured." }, { status: 503 });
  const raw = request.headers.get("authorization") || "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
  if (!token) return NextResponse.json({ error: "Admin bearer authentication required." }, { status: 401 });
  const access = await prisma.adminAccessToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!access || access.revokedAt) return NextResponse.json({ error: "Invalid admin bearer token." }, { status: 401 });
  await prisma.adminAccessToken.update({ where: { id: access.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return null;
}

async function companyId(name: string) {
  const record = await prisma.company.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true, name: true } });
  return record;
}

export async function GET(request: Request) {
  const rejected = await authorize(request); if (rejected) return rejected;
  const name = new URL(request.url).searchParams.get("company")?.trim();
  if (!name) return NextResponse.json({ error: "company is required." }, { status: 400 });
  const company = await companyId(name);
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });
  const [contacts, financials] = await Promise.all([
    prisma.companyContact.findMany({ where: { companyId: company.id }, orderBy: { lastSeenAt: "desc" }, take: 100 }),
    prisma.financialRecord.findMany({ where: { companyId: company.id }, orderBy: [{ publishedAt: "desc" }, { observedAt: "desc" }], take: 30 }),
  ]);
  return NextResponse.json({ company: company.name, contacts, financials });
}

export async function PUT(request: Request) {
  const rejected = await authorize(request); if (rejected) return rejected;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.company !== "string") return NextResponse.json({ error: "company is required." }, { status: 400 });
  const company = await companyId(body.company.trim());
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });

  if (Array.isArray(body.contacts)) {
    if (body.contacts.length > 100) return NextResponse.json({ error: "Maximum 100 contacts per request." }, { status: 400 });
    for (const item of body.contacts) {
      if (!item || typeof item.name !== "string" || !item.name.trim() || typeof item.source !== "string") return NextResponse.json({ error: "Each contact needs name and source." }, { status: 400 });
      const name = item.name.trim();
      const role = typeof item.role === "string" ? item.role.trim() : "";
      await prisma.companyContact.upsert({
        where: { companyId_name_role: { companyId: company.id, name, role: role || "" } },
        create: { companyId: company.id, name, role, email: typeof item.email === "string" ? item.email.trim() : null, phone: typeof item.phone === "string" ? item.phone.trim() : null, linkedinUrl: typeof item.linkedinUrl === "string" ? item.linkedinUrl.trim() : null, source: item.source.trim(), sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl.trim() : null, evidenceId: typeof item.evidenceId === "string" ? item.evidenceId : null, confidence: Math.max(0, Math.min(100, Number(item.confidence) || 50)), verificationStatus: typeof item.verificationStatus === "string" ? item.verificationStatus : "admin_supplied" },
        update: { email: typeof item.email === "string" ? item.email.trim() : undefined, phone: typeof item.phone === "string" ? item.phone.trim() : undefined, linkedinUrl: typeof item.linkedinUrl === "string" ? item.linkedinUrl.trim() : undefined, source: item.source.trim(), sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl.trim() : undefined, evidenceId: typeof item.evidenceId === "string" ? item.evidenceId : undefined, confidence: Math.max(0, Math.min(100, Number(item.confidence) || 50)), verificationStatus: typeof item.verificationStatus === "string" ? item.verificationStatus : "admin_supplied", lastSeenAt: new Date() },
      });
    }
  }

  if (Array.isArray(body.financials)) {
    if (body.financials.length > 30) return NextResponse.json({ error: "Maximum 30 financial records per request." }, { status: 400 });
    for (const item of body.financials) {
      if (!item || typeof item.period !== "string" || typeof item.statementType !== "string" || typeof item.source !== "string") return NextResponse.json({ error: "Each financial record needs period, statementType and source." }, { status: 400 });
      const publishedAt = item.publishedAt ? new Date(item.publishedAt) : null;
      await prisma.financialRecord.upsert({
        where: { companyId_period_statementType_source: { companyId: company.id, period: item.period.trim(), statementType: item.statementType.trim(), source: item.source.trim() } },
        create: { companyId: company.id, period: item.period.trim(), statementType: item.statementType.trim(), currency: typeof item.currency === "string" ? item.currency.trim() : null, source: item.source.trim(), sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl.trim() : null, publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null, summary: typeof item.summary === "string" ? item.summary.trim() : null, metrics: item.metrics && typeof item.metrics === "object" ? item.metrics : undefined, evidenceId: typeof item.evidenceId === "string" ? item.evidenceId : null, confidence: Math.max(0, Math.min(100, Number(item.confidence) || 50)), verificationStatus: typeof item.verificationStatus === "string" ? item.verificationStatus : "admin_supplied" },
        update: { currency: typeof item.currency === "string" ? item.currency.trim() : undefined, sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl.trim() : undefined, publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined, summary: typeof item.summary === "string" ? item.summary.trim() : undefined, metrics: item.metrics && typeof item.metrics === "object" ? item.metrics : undefined, evidenceId: typeof item.evidenceId === "string" ? item.evidenceId : undefined, confidence: Math.max(0, Math.min(100, Number(item.confidence) || 50)), verificationStatus: typeof item.verificationStatus === "string" ? item.verificationStatus : "admin_supplied", observedAt: new Date() },
      });
    }
  }

  const [contacts, financials] = await Promise.all([
    prisma.companyContact.findMany({ where: { companyId: company.id }, orderBy: { lastSeenAt: "desc" }, take: 100 }),
    prisma.financialRecord.findMany({ where: { companyId: company.id }, orderBy: [{ publishedAt: "desc" }, { observedAt: "desc" }], take: 30 }),
  ]);
  return NextResponse.json({ company: company.name, contacts, financials });
}
