import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { getBearerUser } from "../../../lib/auth";
import { monitoringEntitled } from "../../../lib/entitlements";
import { databaseConfigured, prisma } from "../../../lib/db";
import { scoreCompanyRelevance } from "../../../lib/relevance";

const handler = createMcpHandler(({ requestInfo }) => {
  const server = new McpServer(
    { name: "hunt", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "search_companies",
    {
      title: "Search Hunt companies",
      description: "Search the durable Hunt company directory. Returns persisted companies only; it does not trigger monitoring.",
      inputSchema: z.object({ query: z.string().min(1).max(120) }),
    },
    async ({ query }) => {
      const user = requestInfo ? await getBearerUser(requestInfo) : null;
      if (!user || !monitoringEntitled(user)) {
        return { content: [{ type: "text", text: "Authentication or active pilot/paid access is required." }], isError: true };
      }
      const companies = await prisma.company.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { domain: { contains: query, mode: "insensitive" } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: { name: true, domain: true, country: true, updatedAt: true },
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ companies }, null, 2) }],
        structuredContent: { companies },
      };
    },
  );

  server.registerTool(
    "get_company_evidence",
    {
      title: "Get Hunt company evidence",
      description: "Return durable historical observations, signals and monitoring runs for a company. Hunt supplies evidence; the connected AI interprets it.",
      inputSchema: z.object({ company: z.string().min(1).max(160) }),
    },
    async ({ company }) => {
      const user = requestInfo ? await getBearerUser(requestInfo) : null;
      if (!user || !monitoringEntitled(user)) {
        return { content: [{ type: "text", text: "Authentication or active pilot/paid access is required." }], isError: true };
      }
      const record = await prisma.company.findFirst({
        where: { name: { equals: company, mode: "insensitive" } },
        include: {
          observations: { orderBy: { observedAt: "desc" }, take: 100 },
          signals: { orderBy: { createdAt: "desc" }, take: 30 },
          runs: { orderBy: { startedAt: "desc" }, take: 20 },
        },
      });
      if (!record) return { content: [{ type: "text", text: "Company not found in Hunt history." }], isError: true };

      const payload = {
        company: { name: record.name, domain: record.domain, country: record.country },
        observations: record.observations.map((o) => ({ ...o, observedAt: o.observedAt.toISOString(), firstSeenAt: o.firstSeenAt.toISOString(), lastSeenAt: o.lastSeenAt.toISOString(), lastProbeAt: o.lastProbeAt?.toISOString() || null, missingSince: o.missingSince?.toISOString() || null, confirmedRemovedAt: o.confirmedRemovedAt?.toISOString() || null })),
        signals: record.signals.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
        runs: record.runs.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() || null })),
        evidenceRule: "Observations are public evidence collected by Hunt; signals are Hunt's deterministic change/cluster outputs, not AI conclusions.",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    "get_company_changes",
    {
      title: "Get Hunt company changes",
      description: "Return change-focused durable evidence: recent evidence, confirmed removals, signal clusters and recent signals. Hunt reports what changed; the connected AI investigates meaning.",
      inputSchema: z.object({ company: z.string().min(1).max(160) }),
    },
    async ({ company }) => {
      const user = requestInfo ? await getBearerUser(requestInfo) : null;
      if (!user || !monitoringEntitled(user)) {
        return { content: [{ type: "text", text: "Authentication or active pilot/paid access is required." }], isError: true };
      }
      const record = await prisma.company.findFirst({
        where: { name: { equals: company, mode: "insensitive" } },
        include: {
          observations: { orderBy: { observedAt: "desc" }, take: 100 },
          clusters: { orderBy: { lastSeenAt: "desc" }, take: 20 },
          signals: { orderBy: { createdAt: "desc" }, take: 20 },
        },
      });
      if (!record) return { content: [{ type: "text", text: "Company not found in Hunt history." }], isError: true };
      const payload = {
        company: { name: record.name, domain: record.domain, summary: record.generalSummary },
        recentEvidence: record.observations.slice(0, 25).map((o) => ({ id:o.id,title:o.title,category:o.category,source:o.source,url:o.url,status:o.status,observedAt:o.observedAt.toISOString(),firstSeenAt:o.firstSeenAt.toISOString(),lastSeenAt:o.lastSeenAt.toISOString() })),
        removedEvidence: record.observations.filter((o) => o.status === "confirmed_removed").slice(0, 20).map((o) => ({ id:o.id,title:o.title,category:o.category,url:o.url,confirmedRemovedAt:o.confirmedRemovedAt?.toISOString() || null })),
        clusters: record.clusters.map((c) => ({ id:c.id,score:c.score,headline:c.headline,detail:c.detail,categories:c.categories,evidenceIds:c.evidenceIds,lastSeenAt:c.lastSeenAt.toISOString() })),
        signals: record.signals.map((s) => ({ id:s.id,score:s.score,headline:s.headline,detail:s.detail,commercialInterpretation:s.commercialInterpretation,createdAt:s.createdAt.toISOString() })),
        evidenceRule: "Changes and clusters are deterministic evidence structures. External AI remains responsible for commercial interpretation and investigation.",
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    },
  );

  server.registerTool(
    "assess_company_relevance",
    {
      title: "Assess company relevance",
      description: "Deterministically compare a company's persisted evidence against the authenticated user's commercial profile. This is not AI inference.",
      inputSchema: z.object({ company: z.string().min(1).max(160) }),
    },
    async ({ company }) => {
      const user = requestInfo ? await getBearerUser(requestInfo) : null;
      if (!user || !monitoringEntitled(user)) {
        return { content: [{ type: "text", text: "Authentication or active pilot/paid access is required." }], isError: true };
      }
      const record = await prisma.company.findFirst({
        where: { name: { equals: company, mode: "insensitive" } },
        include: { observations: { orderBy: { observedAt: "desc" }, take: 100 } },
      });
      if (!record) return { content: [{ type: "text", text: "Company not found in Hunt history." }], isError: true };

      const relevance = scoreCompanyRelevance(user.profile || {}, record, record.observations);
      const payload = {
        company: { name: record.name, domain: record.domain, country: record.country },
        relevance: { ...relevance, evidence: relevance.evidence.map((e) => ({ ...e, observedAt: e.observedAt.toISOString() })) },
        basis: "deterministic evidence-to-objective matching; no model inference",
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
  if (!databaseConfigured()) return new Response(JSON.stringify({ error: "Database unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
  const user = await getBearerUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: "Bearer authentication required." }), {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="Hunt MCP"' },
    });
  }
  if (!monitoringEntitled(user)) {
    return new Response(JSON.stringify({ error: "Active pilot or paid access required." }), { status: 402, headers: { "content-type": "application/json" } });
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
