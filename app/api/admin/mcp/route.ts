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
