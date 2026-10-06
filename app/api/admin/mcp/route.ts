import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { getAdminBearer } from "../../../../lib/auth";
import { databaseConfigured, prisma } from "../../../../lib/db";

const handler = createMcpHandler(({ requestInfo }) => {
  const server = new McpServer(
    { name: "hunt-admin", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "get_company_evidence",
    {
      title: "Get company evidence for summary",
      description: "Read durable company evidence, history, signals and the existing general summary before an admin AI writes or revises that summary.",
      inputSchema: z.object({ company: z.string().min(1).max(160) }),
    },
    async ({ company }) => {
      const admin = requestInfo ? await getAdminBearer(requestInfo) : null;
      if (!admin) {
        return { content: [{ type: "text", text: "Admin authentication required." }], isError: true };
      }
      const record = await prisma.company.findFirst({
        where: { name: { equals: company, mode: "insensitive" } },
        include: {
          observations: { orderBy: { observedAt: "desc" }, take: 100 },
          signals: { orderBy: { createdAt: "desc" }, take: 30 },
        },
      });
      if (!record) return { content: [{ type: "text", text: "Company not found in Hunt history." }], isError: true };

      const payload = {
        company: {
          name: record.name,
          domain: record.domain,
          country: record.country,
          generalSummary: record.generalSummary,
          summaryUpdatedAt: record.summaryUpdatedAt?.toISOString() || null,
          summaryEvidenceAt: record.summaryEvidenceAt?.toISOString() || null,
          summaryVersion: record.summaryVersion,
        },
        observations: record.observations.map((o) => ({
          id: o.id,
          source: o.source,
          type: o.type,
          category: o.category,
          title: o.title,
          url: o.url,
          observedAt: o.observedAt.toISOString(),
          firstSeenAt: o.firstSeenAt.toISOString(),
          lastSeenAt: o.lastSeenAt.toISOString(),
          status: o.status,
          missCount: o.missCount,
          missingSince: o.missingSince?.toISOString() || null,
          confirmedRemovedAt: o.confirmedRemovedAt?.toISOString() || null,
        })),
        signals: record.signals.map((s) => ({
          id: s.id,
          score: s.score,
          headline: s.headline,
          detail: s.detail,
          commercialInterpretation: s.commercialInterpretation,
          createdAt: s.createdAt.toISOString(),
        })),
        rule: "Use evidence to write a short general company summary. Do not invent facts or tailor the summary to a user's profession, services, or sales objective.",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    "update_company_summary",
    {
      title: "Update general company summary",
      description: "Store a short shared company summary derived from Hunt evidence. This is general context, not a user-specific investigation.",
      inputSchema: z.object({
        company: z.string().min(1).max(160),
        summary: z.string().min(1).max(900),
      }),
    },
    async ({ company, summary }) => {
      const admin = requestInfo ? await getAdminBearer(requestInfo) : null;
      if (!admin) {
        return { content: [{ type: "text", text: "Admin authentication required." }], isError: true };
      }
      const record = await prisma.company.findFirst({
        where: { name: { equals: company, mode: "insensitive" } },
        select: { id: true },
      });
      if (!record) return { content: [{ type: "text", text: "Company not found in Hunt history." }], isError: true };

      const evidence = await prisma.observation.aggregate({
        where: { companyId: record.id },
        _max: { observedAt: true },
      });

      const updated = await prisma.company.update({
        where: { id: record.id },
        data: {
          generalSummary: summary.trim(),
          summaryUpdatedAt: new Date(),
          summaryEvidenceAt: evidence._max.observedAt ?? null,
          summaryVersion: { increment: 1 },
        },
        select: {
          name: true,
          generalSummary: true,
          summaryUpdatedAt: true,
          summaryEvidenceAt: true,
          summaryVersion: true,
        },
      });

      const payload = {
        company: {
          ...updated,
          summaryUpdatedAt: updated.summaryUpdatedAt?.toISOString() || null,
          summaryEvidenceAt: updated.summaryEvidenceAt?.toISOString() || null,
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    "get_company_profile",
    {
      title: "Get company profile context",
      description: "Read existing durable contacts and source-backed financial records for a company.",
      inputSchema: z.object({ company: z.string().min(1).max(160) }),
    },
    async ({ company }) => {
      const admin = requestInfo ? await getAdminBearer(requestInfo) : null;
      if (!admin) return { content: [{ type: "text", text: "Admin authentication required." }], isError: true };
      const record = await prisma.company.findFirst({
        where: { name: { equals: company, mode: "insensitive" } },
        select: {
          name: true,
          contacts: { orderBy: { lastSeenAt: "desc" }, take: 100 },
          financialRecords: { orderBy: [{ publishedAt: "desc" }, { observedAt: "desc" }], take: 30 },
        },
      });
      if (!record) return { content: [{ type: "text", text: "Company not found in Hunt history." }], isError: true };
      const payload = {
        company: record.name,
        contacts: record.contacts,
        financials: record.financialRecords.map((f) => ({ ...f, publishedAt: f.publishedAt?.toISOString() || null, observedAt: f.observedAt.toISOString() })),
        rule: "Only store source-backed professional contact and financial information. Preserve provenance and do not infer missing financial data.",
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    },
  );

  server.registerTool(
    "update_company_profile",
    {
      title: "Update company contacts and financials",
      description: "Upsert source-backed professional contacts and financial records. Call get_company_evidence or get_company_profile first.",
      inputSchema: z.object({
        company: z.string().min(1).max(160),
        contacts: z.array(z.object({
          name: z.string().min(1).max(180),
          role: z.string().max(180).optional(),
          email: z.string().max(320).optional(),
          phone: z.string().max(80).optional(),
          linkedinUrl: z.string().url().max(500).optional(),
          source: z.string().min(1).max(160),
          sourceUrl: z.string().url().max(1000).optional(),
          evidenceId: z.string().max(100).optional(),
          confidence: z.number().int().min(0).max(100).optional(),
          verificationStatus: z.enum(["admin_supplied", "verified", "unverified", "needs_review"]).optional(),
        })).max(100).optional(),
        financials: z.array(z.object({
          period: z.string().min(1).max(80),
          statementType: z.string().min(1).max(120),
          currency: z.string().max(20).optional(),
          source: z.string().min(1).max(160),
          sourceUrl: z.string().url().max(1000).optional(),
          publishedAt: z.string().optional(),
          summary: z.string().max(2000).optional(),
          metrics: z.record(z.string(), z.unknown()).optional(),
          evidenceId: z.string().max(100).optional(),
          confidence: z.number().int().min(0).max(100).optional(),
          verificationStatus: z.enum(["admin_supplied", "verified", "unverified"]).optional(),
        })).max(30).optional(),
      }),
    },
    async ({ company, contacts, financials }) => {
      const admin = requestInfo ? await getAdminBearer(requestInfo) : null;
      if (!admin) return { content: [{ type: "text", text: "Admin authentication required." }], isError: true };
      const record = await prisma.company.findFirst({ where: { name: { equals: company, mode: "insensitive" } }, select: { id: true, name: true } });
      if (!record) return { content: [{ type: "text", text: "Company not found in Hunt history." }], isError: true };
      for (const item of contacts || []) {
        await prisma.companyContact.upsert({
          where: { companyId_name_role: { companyId: record.id, name: item.name.trim(), role: item.role?.trim() || "" } },
          create: { companyId: record.id, name: item.name.trim(), role: item.role?.trim() || "", email: item.email?.trim() || null, phone: item.phone?.trim() || null, linkedinUrl: item.linkedinUrl?.trim() || null, source: item.source.trim(), sourceUrl: item.sourceUrl?.trim() || null, evidenceId: item.evidenceId || null, confidence: item.confidence ?? 50, verificationStatus: item.verificationStatus ?? "admin_supplied" },
          update: { email: item.email?.trim(), phone: item.phone?.trim(), linkedinUrl: item.linkedinUrl?.trim(), source: item.source.trim(), sourceUrl: item.sourceUrl?.trim(), evidenceId: item.evidenceId, confidence: item.confidence ?? 50, verificationStatus: item.verificationStatus ?? "admin_supplied", lastSeenAt: new Date() },
        });
      }
      for (const item of financials || []) {
        const date = item.publishedAt ? new Date(item.publishedAt) : null;
        const metrics = item.metrics === undefined ? undefined : JSON.parse(JSON.stringify(item.metrics));
        await prisma.financialRecord.upsert({
          where: { companyId_period_statementType_source: { companyId: record.id, period: item.period.trim(), statementType: item.statementType.trim(), source: item.source.trim() } },
          create: { companyId: record.id, period: item.period.trim(), statementType: item.statementType.trim(), currency: item.currency?.trim() || null, source: item.source.trim(), sourceUrl: item.sourceUrl?.trim() || null, publishedAt: date && !Number.isNaN(date.getTime()) ? date : null, summary: item.summary?.trim() || null, metrics, evidenceId: item.evidenceId || null, confidence: item.confidence ?? 50, verificationStatus: item.verificationStatus ?? "admin_supplied" },
          update: { currency: item.currency?.trim(), sourceUrl: item.sourceUrl?.trim(), publishedAt: date && !Number.isNaN(date.getTime()) ? date : undefined, summary: item.summary?.trim(), metrics, evidenceId: item.evidenceId, confidence: item.confidence ?? 50, verificationStatus: item.verificationStatus ?? "admin_supplied", observedAt: new Date() },
        });
      }
      const payload = await prisma.company.findUnique({
        where: { id: record.id },
        select: { name: true, contacts: { orderBy: { lastSeenAt: "desc" }, take: 100 }, financialRecords: { orderBy: [{ publishedAt: "desc" }, { observedAt: "desc" }], take: 30 } },
      });
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload || {} };
    },
  );

  server.registerTool(
    "get_admin_review_tasks",
    {
      title: "Get admin review tasks",
      description: "Return durable extraction and evidence problems requiring administrator review, including original source URLs.",
      inputSchema: z.object({ status: z.enum(["open", "resolved", "all"]).optional() }),
    },
    async ({ status }) => {
      const admin = requestInfo ? await getAdminBearer(requestInfo) : null;
      if (!admin) return { content: [{ type: "text", text: "Admin authentication required." }], isError: true };
      const tasks = await prisma.adminReviewTask.findMany({
        where: status === "all" ? {} : { status: status || "open" },
        orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
        take: 100,
        include: { company: { select: { name: true, domain: true } } },
      });
      const payload = { tasks };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    },
  );

  server.registerTool(
    "resolve_admin_review_task",
    {
      title: "Resolve admin review task",
      description: "Mark an administrator review task resolved after handling the underlying evidence issue.",
      inputSchema: z.object({ id: z.string().min(1), status: z.enum(["open", "resolved"]) }),
    },
    async ({ id, status }) => {
      const admin = requestInfo ? await getAdminBearer(requestInfo) : null;
      if (!admin) return { content: [{ type: "text", text: "Admin authentication required." }], isError: true };
      const task = await prisma.adminReviewTask.update({
        where: { id },
        data: { status, resolvedAt: status === "resolved" ? new Date() : null, resolvedBy: status === "resolved" ? "admin-agent" : null },
        include: { company: { select: { name: true, domain: true } } },
      });
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }], structuredContent: task };
    },
  );

  return server;
}, { legacy: "stateless", responseMode: "json" });

async function authorized(request: Request) {
  if (!databaseConfigured()) {
    return new Response(JSON.stringify({ error: "Database unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  const admin = await getAdminBearer(request);
  if (!admin) {
    return new Response(JSON.stringify({ error: "Admin bearer authentication required." }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="Hunt Admin MCP"',
      },
    });
  }
  return null;
}

export async function POST(request: Request) {
  const rejected = await authorized(request);
  if (rejected) return rejected;
  return handler.fetch(request);
}

export async function GET(request: Request) {
  const rejected = await authorized(request);
  if (rejected) return rejected;
  return handler.fetch(request);
}

export async function DELETE(request: Request) {
  const rejected = await authorized(request);
  if (rejected) return rejected;
  return handler.fetch(request);
}
