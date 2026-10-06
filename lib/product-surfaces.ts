import type { Observation } from "./signal-adapters";

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

export async function detectProductSurfaces(
  domain: string,
  baseUrl = "https://" + domain,
): Promise<{ observations: Observation[]; errors: string[] }> {
  const observations: Observation[] = [];
  const errors: string[] = [];

  const checks = CANDIDATES.map(async (candidate) => {
    const url = new URL(candidate.path, baseUrl).toString();
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

      if (response.status < 200 || response.status >= 400) return;

      const contentType = response.headers.get("content-type") || "";
      const location = response.headers.get("location");
      const evidenceUrl = location
        ? new URL(location, url).toString()
        : url;

      // A redirect to a known candidate is still evidence, but a generic
      // redirect back to the homepage is not enough to call this a product surface.
      if (response.status >= 300 && response.status < 400 && location) {
        const redirected = new URL(location, url);
        if (samePath(redirected.toString(), "/")) return;
      }

      const body = (await response.text()).slice(0, 120_000).toLowerCase();
      const strongApiEvidence =
        candidate.label.includes("API") ||
        candidate.label.includes("OpenAPI") ||
        candidate.label.includes("Swagger") ||
        /openapi|swagger|api reference|api documentation|developer portal/.test(body);

      if (!strongApiEvidence && candidate.path === "/api") {
        const looksLikeWebApp =
          contentType.includes("text/html") &&
          !/api|json|graphql|developer|documentation/.test(body);
        if (looksLikeWebApp) return;
      }

      observations.push({
        source: "Official public surface",
        type: "product",
        title: candidate.label + ": " + candidate.path,
        category: "Product / API surface",
        url: evidenceUrl,
        observedAt: new Date().toISOString(),
        fingerprint: await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode("product-surface|" + domain.toLowerCase() + "|" + candidate.path),
        ).then((digest) =>
          Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join(""),
        ),
        metadata: {
          domain,
          path: candidate.path,
          status: response.status,
          contentType,
        },
      });
    } catch {
      // A missing candidate is normal; only aggregate unexpected fetch failures
      // when the whole origin is inaccessible.
    } finally {
      clearTimeout(timeout);
    }
  });

  await Promise.all(checks);

  return {
    observations: Array.from(new Map(observations.map((item) => [item.fingerprint, item])).values()),
    errors,
  };
}
