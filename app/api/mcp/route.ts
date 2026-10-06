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
    "get_opportunity_candidates",
    {
      title: "Get Hunt opportunity candidates",
      description: "Return deterministic opportunity candidates created for the authenticated user's watched companies and commercial profile.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
    },
    async ({ limit }) => {
      const user = requestInfo ? await getBearerUser(requestInfo) : null;
      if (!user || !monitoringEntitled(user)) return { content: [{ type: "text", text: "Authentication or active pilot/paid access is required." }], isError: true };
      const candidates = await prisma.opportunityCandidate.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
        take: limit || 20,
        include: { company: true, cluster: true },
      });
      const payload = { opportunities: candidates.map((o) => ({ id:o.id, score:o.score, status:o.status, investigationState:o.investigationState, reason:o.reason, evidenceIds:o.evidenceIds, company:{name:o.company.name,domain:o.company.domain}, cluster:{id:o.cluster.id,headline:o.cluster.headline,categories:o.cluster.categories} })) };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    },
  );

  server.registerTool(
    "get_notifications",
    {
      title: "Get Hunt notifications",
      description: "Return recent durable Hunt notifications for the authenticated user.",
      inputSchema: z.object({ unreadOnly: z.boolean().optional() }),
    },
    async ({ unreadOnly }) => {
      const user = requestInfo ? await getBearerUser(requestInfo) : null;
      if (!user || !monitoringEntitled(user)) return { content: [{ type: "text", text: "Authentication or active pilot/paid access is required." }], isError: true };
      const notifications = await prisma.notification.findMany({
        where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { company: true, opportunity: true },
      });
      const payload = { unread: notifications.filter((n) => !n.readAt).length, notifications: notifications.map((n) => ({ id:n.id,type:n.type,title:n.title,body:n.body,readAt:n.readAt?.toISOString() || null,createdAt:n.createdAt.toISOString(),company:n.company.name,opportunityId:n.opportunityId })) };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
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

  server.registerTool(
    "get_company_profile",
    {
      title: "Get Hunt company profile",
      description: "Return a company's general summary, durable professional contacts and source-backed financial records. Missing financial data is not treated as evidence of poor financial health.",
      inputSchema: z.object({ company: z.string().min(1).max(160) }),
    },
    async ({ company }) => {
      const user = requestInfo ? await getBearerUser(requestInfo) : null;
      if (!user || !monitoringEntitled(user)) return { content: [{ type: "text", text: "Authentication or active pilot/paid access is required." }], isError: true };
      const record = await prisma.company.findFirst({
        where: { name: { equals: company, mode: "insensitive" } },
        select: {
          name: true, domain: true, country: true, generalSummary: true,
          contacts: { orderBy: { lastSeenAt: "desc" }, take: 30 },
          financialRecords: { orderBy: [{ publishedAt: "desc" }, { observedAt: "desc" }], take: 10 },
        },
      });
      if (!record) return { content: [{ type: "text", text: "Company not found in Hunt history." }], isError: true };
      const payload = {
        company: { name: record.name, domain: record.domain, country: record.country, summary: record.generalSummary },
        contacts: record.contacts,
        financials: record.financialRecords.map((f) => ({ ...f, publishedAt: f.publishedAt?.toISOString() || null, observedAt: f.observedAt.toISOString() })),
        provenanceRule: "Contacts and financial records are source-backed company context. Hunt does not infer private financial health from missing data.",
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    },
  );

  server.registerTool(
    "get_company_contacts",
    {
      title: "Get Hunt company contacts",
      description: "Return publicly discovered company contacts and leadership details preserved by Hunt. Contact data comes from public evidence; the connected AI decides who is commercially relevant.",
      inputSchema: z.object({ company: z.string().min(1).max(160) }),
    },
    async ({ company }) => {
      const user = requestInfo ? await getBearerUser(requestInfo) : null;
      if (!user || !monitoringEntitled(user)) return { content: [{ type: "text", text: "Authentication or active pilot/paid access is required." }], isError: true };
      const record = await prisma.company.findFirst({
        where: { name: { equals: company, mode: "insensitive" } },
        select: { name: true, domain: true, contacts: { orderBy: { lastSeenAt: "desc" }, take: 100 } },
      });
      if (!record) return { content: [{ type: "text", text: "Company not found in Hunt history." }], isError: true };
      const payload = { company: { name: record.name, domain: record.domain }, contacts: record.contacts };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    },
  );

  server.registerTool(
    "get_company_financials",
    {
      title: "Get Hunt company financial records",
      description: "Return the latest public financial statement/report records Hunt has discovered for a company, including source and any structured metrics available.",
      inputSchema: z.object({ company: z.string().min(1).max(160) }),
    },
    async ({ company }) => {
      const user = requestInfo ? await getBearerUser(requestInfo) : null;
      if (!user || !monitoringEntitled(user)) return { content: [{ type: "text", text: "Authentication or active pilot/paid access is required." }], isError: true };
      const record = await prisma.company.findFirst({
        where: { name: { equals: company, mode: "insensitive" } },
        select: { name: true, domain: true, financialRecords: { orderBy: [{ publishedAt: "desc" }, { observedAt: "desc" }], take: 50 } },
      });
      if (!record) return { content: [{ type: "text", text: "Company not found in Hunt history." }], isError: true };
      const payload = { company: { name: record.name, domain: record.domain }, latest: record.financialRecords[0] || null, records: record.financialRecords };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    },
  );

  return server;
}, { legacy: "stateless", responseMode: "json" });

const requestCounts = new Map<string, { count: number; resetAt: number }>();

function securityCheck(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 1024 * 1024) return new Response(JSON.stringify({ error: "Request too large." }), { status: 413, headers: { "content-type": "application/json" } });

  const configuredHosts = (process.env.HUNT_MCP_ALLOWED_HOSTS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const host = (request.headers.get("host") || "").toLowerCase().split(":")[0];
  if (configuredHosts.length && host && !configuredHosts.includes(host)) {
    return new Response(JSON.stringify({ error: "Host not allowed." }), { status: 403, headers: { "content-type": "application/json" } });
  }

  const origin = request.headers.get("origin");
  if (origin) {
    const allowedOrigins = (process.env.HUNT_MCP_ALLOWED_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (allowedOrigins.length && !allowedOrigins.includes(origin)) {
      return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers: { "content-type": "application/json" } });
    }
  }

  const bearer = request.headers.get("authorization") || "";
  const key = bearer.startsWith("Bearer ") ? bearer.slice(7, 47) : (request.headers.get("x-forwarded-for") || "anonymous").split(",")[0].trim();
  const now = Date.now();
  const current = requestCounts.get(key);
  if (!current || current.resetAt <= now) requestCounts.set(key, { count: 1, resetAt: now + 60_000 });
  else if (current.count >= 60) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { "content-type": "application/json", "retry-after": "60" } });
  else current.count++;
  return null;
}

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
  const security = securityCheck(request);
  if (security) return security;
  const rejected = await authorized(request);
  if (rejected) return rejected;
  return handler.fetch(request);
}

export async function GET(request: Request) {
  const security = securityCheck(request);
  if (security) return security;
  const rejected = await authorized(request);
  if (rejected) return rejected;
  return handler.fetch(request);
}

export async function DELETE(request: Request) {
  const security = securityCheck(request);
  if (security) return security;
  const rejected = await authorized(request);
  if (rejected) return rejected;
  return handler.fetch(request);
}
