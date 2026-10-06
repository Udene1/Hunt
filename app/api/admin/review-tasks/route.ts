import { NextResponse } from "next/server";
import { getAdminBearer } from "../../../../lib/auth";
import { databaseConfigured, prisma } from "../../../../lib/db";

async function auth(request: Request) {
  if (!databaseConfigured()) return new Response(JSON.stringify({ error: "Database unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
  if (!await getAdminBearer(request)) return new Response(JSON.stringify({ error: "Admin bearer authentication required." }), { status: 401, headers: { "content-type": "application/json" } });
  return null;
}

export async function GET(request: Request) {
  const rejected = await auth(request); if (rejected) return rejected;
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "open";
  const tasks = await prisma.adminReviewTask.findMany({
    where: status === "all" ? {} : { status },
    orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
    take: 100,
    include: { company: { select: { name: true, domain: true } } },
  });
  return NextResponse.json({ tasks });
}

export async function PUT(request: Request) {
  const rejected = await auth(request); if (rejected) return rejected;
  const body = await request.json().catch(() => ({}));
  if (typeof body.id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 });
  const status = body.status === "resolved" ? "resolved" : body.status === "open" ? "open" : null;
  if (!status) return NextResponse.json({ error: "status must be open or resolved" }, { status: 400 });
  const task = await prisma.adminReviewTask.update({
    where: { id: body.id },
    data: { status, resolvedAt: status === "resolved" ? new Date() : null, resolvedBy: status === "resolved" ? "admin" : null },
    include: { company: { select: { name: true, domain: true } } },
  });
  return NextResponse.json({ task });
}
