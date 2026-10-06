import { NextResponse } from "next/server";
import { prisma } from "../../../lib/db";
import { getBearerUser } from "../../../lib/auth";
import { monitoringEntitled } from "../../../lib/entitlements";

export async function GET(request: Request) {
  const user = await getBearerUser(request);
  if (!user || !monitoringEntitled(user)) return NextResponse.json({ error: "Active pilot or paid access required." }, { status: 402 });
  const company = new URL(request.url).searchParams.get("company")?.trim();
  if (!company) return NextResponse.json({ error: "company is required" }, { status: 400 });
  const record = await prisma.company.findFirst({
    where: { name: { equals: company, mode: "insensitive" } },
    select: { name: true, domain: true, contacts: { where: { verificationStatus: "verified" }, orderBy: { lastSeenAt: "desc" }, take: 100 } },
  });
  if (!record) return NextResponse.json({ error: "Company not found in Hunt history." }, { status: 404 });
  return NextResponse.json({ ...record, verification: record.contacts.length ? "verified_records_available" : "no_verified_contacts_found" });
}
