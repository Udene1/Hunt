import { NextResponse } from "next/server";
import { prisma, databaseConfigured } from "../../../lib/db";
import { findCompany, normalizeCompany, COMPANY_CATALOG } from "../../../lib/companies";
import { getCurrentUser } from "../../../lib/auth";
import { monitoringEntitled } from "../../../lib/entitlements";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!databaseConfigured()) return NextResponse.json({ companies: [], persistent: false });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ companies: [], persistent: false, code: "authentication_required" }, { status: 401 });
  try {
    const watches = await prisma.userWatch.findMany({
      where: { userId: user.id },
      include: { company: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ companies: watches.map((w) => w.company), watches: watches.map((w) => ({ companyId:w.companyId, company:w.company.name, signalTypes:w.signalTypes, minScore:w.minScore })), persistent: true });
  } catch {
    return NextResponse.json({ companies: [], persistent: false, error: "database unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required.", code: "authentication_required" }, { status: 401 });
  if (!monitoringEntitled(user)) return NextResponse.json({ error: "Watching companies requires a pilot or paid account.", code: "plan_required" }, { status: 402 });

  const body = await request.json().catch(() => ({}));
  const raw = String(body.company || "").trim();
  const seed = findCompany(raw) || COMPANY_CATALOG.find((c) => c.name.toLowerCase() === raw.toLowerCase());
  if (!raw && !seed) return NextResponse.json({ error: "company is required" }, { status: 400 });
  if (!databaseConfigured()) return NextResponse.json({ persistent: false, message: "DATABASE_URL is not configured" }, { status: 202 });

  const name = seed?.name || raw;
  const domain = seed?.domain || null;
  const normalized = normalizeCompany(name);
  try {
    const company = await prisma.company.upsert({
      where: { normalized },
      update: { domain: domain || undefined },
      create: { name, normalized, domain },
    });
    await prisma.userWatch.upsert({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      update: {},
      create: { userId: user.id, companyId: company.id },
    });
    return NextResponse.json({ company, persistent: true });
  } catch {
    return NextResponse.json({ error: "database unavailable" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required.", code: "authentication_required" }, { status: 401 });
  if (!monitoringEntitled(user)) return NextResponse.json({ error: "Watching companies requires a pilot or paid account.", code: "plan_required" }, { status: 402 });

  const company = new URL(request.url).searchParams.get("company")?.trim();
  if (!company) return NextResponse.json({ error: "company is required" }, { status: 400 });
  if (!databaseConfigured()) return NextResponse.json({ persistent: false }, { status: 202 });
  try {
    const seed = findCompany(company);
    const normalized = normalizeCompany(seed?.name || company);
    const found = await prisma.company.findUnique({ where: { normalized } });
    if (found) await prisma.userWatch.deleteMany({ where: { userId: user.id, companyId: found.id } });
    return NextResponse.json({ ok: true, persistent: true });
  } catch {
    return NextResponse.json({ error: "database unavailable" }, { status: 503 });
  }
}


export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error:"Authentication required.", code:"authentication_required" }, {status:401});
  if (!monitoringEntitled(user)) return NextResponse.json({ error:"Watching companies requires a pilot or paid account.", code:"plan_required" }, {status:402});
  if (!databaseConfigured()) return NextResponse.json({error:"Database unavailable"},{status:503});
  const body=await request.json().catch(()=>({}));
  const raw=String(body.company||"").trim();
  if(!raw) return NextResponse.json({error:"company is required"},{status:400});
  const seed=findCompany(raw);
  const company=await prisma.company.findUnique({where:{normalized:normalizeCompany(seed?.name||raw)}});
  if(!company) return NextResponse.json({error:"Company is not being watched."},{status:404});
  const watch=await prisma.userWatch.findUnique({where:{userId_companyId:{userId:user.id,companyId:company.id}}});
  if(!watch) return NextResponse.json({error:"Company is not being watched."},{status:404});
  const signalTypes=Array.isArray(body.signalTypes)?body.signalTypes.filter((x:any)=>typeof x==="string").slice(0,20):null;
  const minScore=Math.max(20,Math.min(99,Number(body.minScore||20)));
  const updated=await prisma.userWatch.update({where:{id:watch.id},data:{signalTypes:signalTypes==null?watch.signalTypes:signalTypes,minScore}});
  return NextResponse.json({watch:updated});
}
