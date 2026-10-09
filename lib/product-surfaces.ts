import type { Observation } from "./signal-adapters";

export type SurfaceProbe = {
  surfaceIdentity: string;
  domain: string;
  path: string;
  label: string;
  url: string;
  status: "present" | "missing" | "probe_failed";
  httpStatus: number | null;
  evidenceUrl: string | null;
  checkedAt: string;
  reason?: string;
};

const CANDIDATES = [
  { path: "/developers", label: "Developer portal" },
  { path: "/developer", label: "Developer portal" },
  { path: "/docs", label: "Public documentation" },
  { path: "/api", label: "Public API surface" },
  { path: "/api/docs", label: "API documentation" },
  { path: "/swagger", label: "Swagger API documentation" },
  { path: "/swagger-ui", label: "Swagger API documentation" },
  { path: "/openapi.json", label: "OpenAPI specification" },
  { path: "/openapi.yaml", label: "OpenAPI specification" },
];

function samePath(url: string, path: string) {
  try {
    return new URL(url).pathname.replace(/\/$/, "") === path;
  } catch {
    return false;
  }
}

function normalizeDocumentBody(body: string, contentType: string) {
  if (contentType.includes("application/json") || /(^|[\s,{])(?:openapi|swagger|paths|components)(?:[\s:},]|$)/i.test(body)) {
    try {
      const value = JSON.parse(body);
      return JSON.stringify(sortJson(value));
    } catch {
      // YAML or malformed JSON: fall through to normalized text.
    }
  }

  const visible = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return visible.slice(0, 30000);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

async function sha256(value: string) {
  return crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ).then((digest) =>
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
  );
}

export async function detectProductSurfaces(
  domain: string,
  baseUrl = "https://" + domain,
): Promise<{ observations: Observation[]; errors: string[]; probes: SurfaceProbe[] }> {
  const observations: Observation[] = [];
  const errors: string[] = [];

  const origins = Array.from(new Set([
    baseUrl.replace(/\/$/, ""),
    "https://developer." + domain,
    "https://docs." + domain,
    "https://api." + domain,
  ]));

  const probes: SurfaceProbe[] = [];
  const checks = origins.flatMap((origin) => CANDIDATES.map(async (candidate) => {
    const url = new URL(candidate.path, origin + "/").toString();
    const surfaceIdentity = [
      "product-surface",
      domain.toLowerCase(),
      new URL(url).origin.toLowerCase(),
      candidate.path,
    ].join("|");
    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "manual",
        cache: "no-store",
        headers: {
          "user-agent": "Opportunity-Intelligence/0.2 evidence-monitor",
          accept: "text/html,application/json,text/plain,*/*",
        },
      });

      if (response.status === 404 || response.status === 410) {
        probes.push({
          surfaceIdentity,
          domain,
          path: candidate.path,
          label: candidate.label,
          url,
          status: "missing",
          httpStatus: response.status,
          evidenceUrl: url,
          checkedAt,
          reason: response.status === 410 ? "HTTP 410 Gone" : "HTTP 404 Not Found",
        });
        return;
      }

      if (response.status < 200 || response.status >= 400) {
        probes.push({ surfaceIdentity, domain, path: candidate.path, label: candidate.label, url, status: "probe_failed", httpStatus: response.status, evidenceUrl: url, checkedAt, reason: "HTTP " + response.status });
        return;
      }

      // A redirect alone is not proof that a documentation/API surface exists.
      // Catch-all routing commonly redirects arbitrary paths to a generic page.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        probes.push({ surfaceIdentity, domain, path: candidate.path, label: candidate.label, url, status: "probe_failed", httpStatus: response.status, evidenceUrl: location ? new URL(location, url).toString() : null, checkedAt, reason: "redirect_not_verified_as_a_real_surface" });
        return;
      }

      const contentType = response.headers.get("content-type") || "";
      const evidenceUrl = url;
      const rawBody = await response.text();
      const body = rawBody.slice(0, 120_000).toLowerCase();
      const visibleText = body
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      // Avoid matching generic HTML attributes such as input placeholder="Search".
      const templateMarkers = ["illustrative pending independent verification", "replace the entries with real", "replace these entries with real", "lorem ipsum", "your company name", "placeholder text", "placeholder content", "sample company data", "replace this text"];
      const matchedTemplateMarkers = templateMarkers.filter((marker) => visibleText.includes(marker));
      if (matchedTemplateMarkers.length > 0) {
        probes.push({ surfaceIdentity, domain, path: candidate.path, label: candidate.label, url, status: "probe_failed", httpStatus: response.status, evidenceUrl: url, checkedAt, reason: "template_or_placeholder_content_detected: " + matchedTemplateMarkers.join(", ") });
        return;
      }

      let parsedJson: unknown = null;
      if (contentType.includes("json")) {
        try { parsedJson = JSON.parse(rawBody); } catch { /* malformed JSON is not a valid API surface */ }
      }
      const jsonObject = parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)
        ? parsedJson as Record<string, unknown>
        : null;
      const openApiSpec = Boolean(jsonObject &&
        (typeof jsonObject.openapi === "string" || typeof jsonObject.swagger === "string") &&
        jsonObject.paths && typeof jsonObject.paths === "object");
      const swaggerUi = /swagger-ui(?:-bundle|-standalone-preset)?|swagger-ui-init|redoc/i.test(body);
      const documentationText = /api reference|api documentation|developer portal|graphql playground|graphiql|apollo sandbox/i.test(body);
      const apiRootJson = candidate.path === "/api" && Boolean(parsedJson) && contentType.includes("json");
      const strongApiEvidence = openApiSpec || swaggerUi || documentationText || apiRootJson;
      const documentationPath = /docs|swagger|developer|openapi/i.test(candidate.path);

      if ((documentationPath && !strongApiEvidence) || (candidate.path === "/api" && !strongApiEvidence)) {
        probes.push({ surfaceIdentity, domain, path: candidate.path, label: candidate.label, url, status: "probe_failed", httpStatus: response.status, evidenceUrl: url, checkedAt, reason: "response_does_not_contain_recognizable_api_or_documentation_evidence" });
        return;
      }

      probes.push({ surfaceIdentity, domain, path: candidate.path, label: candidate.label, url, status: "present", httpStatus: response.status, evidenceUrl, checkedAt });

      const normalizedBody = normalizeDocumentBody(rawBody.slice(0, 120_000), contentType);
      const versionSignature = await sha256([
        response.status,
        contentType.toLowerCase(),
        evidenceUrl,
        normalizedBody,
      ].join("|"));
      const fingerprint = await sha256(surfaceIdentity + "|version|" + versionSignature);

      observations.push({
        source: "Official public surface",
        type: "product",
        title: candidate.label + ": " + candidate.path,
        category: "Product / API surface",
        url: evidenceUrl,
        observedAt: new Date().toISOString(),
        fingerprint,
        metadata: {
          domain,
          path: candidate.path,
          status: response.status,
          contentType,
          surfaceIdentity,
          versionSignature,
        },
      });
    } catch (error) {
      probes.push({
        surfaceIdentity,
        domain,
        path: candidate.path,
        label: candidate.label,
        url,
        status: "probe_failed",
        httpStatus: null,
        evidenceUrl: null,
        checkedAt,
        reason: error instanceof Error && error.name === "AbortError" ? "timeout" : "network error",
      });
    } finally {
      clearTimeout(timeout);
    }
  }));

  await Promise.all(checks);

  return {
    observations: Array.from(
      new Map(
        observations.map((item) => [item.fingerprint, item]),
      ).values(),
    ),
    probes: Array.from(
      new Map(probes.map((probe) => [probe.surfaceIdentity, probe])).values(),
    ),
    errors,
  };
}
