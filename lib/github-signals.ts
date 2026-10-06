import type { Observation, SignalAdapterResult } from "./signal-adapters";

type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description?: string | null;
  fork?: boolean;
  archived?: boolean;
  pushed_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  language?: string | null;
  owner?: { login?: string; html_url?: string };
};

type GitHubEvent = {
  id: string;
  type?: string;
  created_at?: string;
  repo?: { name?: string; html_url?: string };
  payload?: {
    action?: string;
    ref?: string;
    head?: string;
    release?: { id?: number; name?: string; tag_name?: string; html_url?: string; published_at?: string | null };
    pull_request?: { number?: number; title?: string; html_url?: string };
  };
};

type GitHubRelease = {
  id: number;
  name?: string | null;
  tag_name: string;
  html_url: string;
  published_at?: string | null;
  prerelease?: boolean;
  draft?: boolean;
};

const API = "https://api.github.com";
const headers = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2026-03-10",
  "user-agent": "Opportunity-Intelligence/0.3 evidence-monitor",
};

function companyTokens(company: string) {
  return company.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function likelyOwnedRepository(repo: GitHubRepo, company: string) {
  const tokens = companyTokens(company);
  const owner = (repo.owner?.login || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  // A third-party SDK mentioning a company is not evidence of that company's
  // own GitHub activity. Prefer a direct company-owned GitHub identity.
  return tokens.some((token) => {
    const normalizedToken = token.replace(/[^a-z0-9]+/g, "");
    return normalizedToken.length >= 4 && (
      owner === normalizedToken ||
      owner === normalizedToken + "inc" ||
      owner === normalizedToken + "ltd" ||
      owner === normalizedToken + "hq"
    );
  });
}

async function githubFetch<T>(path: string, timeoutMs = 5000): Promise<{ data: T | null; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(API + path, {
      signal: controller.signal,
      cache: "no-store",
      headers,
    });
    if (!response.ok) return { data: null, status: response.status };
    return { data: await response.json() as T, status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function observeRepo(repo: GitHubRepo) {
  return {
    source: "GitHub",
    type: "technology" as const,
    title: "Public repository: " + repo.full_name,
    category: "Engineering / GitHub activity",
    url: repo.html_url,
    observedAt: repo.updated_at || repo.pushed_at || repo.created_at || new Date().toISOString(),
    fingerprint: await sha256("github|repository|" + repo.id),
    metadata: {
      repository: repo.full_name,
      repositoryId: repo.id,
      owner: repo.owner?.login || "",
      language: repo.language || "",
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      fork: Boolean(repo.fork),
      archived: Boolean(repo.archived),
      pushedAt: repo.pushed_at || "",
    },
  } satisfies Observation;
}

async function collectRepoEvents(repo: GitHubRepo) {
  const result = await githubFetch<GitHubEvent[]>(
    "/repos/" + encodeURIComponent(repo.owner?.login || "") + "/" + encodeURIComponent(repo.name) + "/events?per_page=10",
  );
  if (!result.data) return { observations: [] as Observation[], error: result.status === 403 ? "GitHub rate limit reached" : "GitHub events unavailable" };

  const observations: Observation[] = [];
  for (const event of result.data.slice(0, 10)) {
    if (!event.id || !event.type) continue;
    if (event.type === "PushEvent") {
      const ref = event.payload?.ref?.replace(/^refs\/heads\//, "") || "branch";
      observations.push({
        source: "GitHub",
        type: "technology",
        title: "Repository push activity: " + repo.full_name + " (" + ref + ")",
        category: "Engineering / GitHub activity",
        url: repo.html_url,
        observedAt: event.created_at || new Date().toISOString(),
        fingerprint: await sha256("github|event|" + event.id),
        metadata: { eventId: event.id, eventType: event.type, repository: repo.full_name, ref },
      });
    } else if (event.type === "PullRequestEvent") {
      const action = event.payload?.action || "updated";
      const pr = event.payload?.pull_request;
      observations.push({
        source: "GitHub",
        type: "technology",
        title: "Pull request " + action + ": " + (pr?.title || repo.full_name),
        category: "Engineering / GitHub activity",
        url: pr?.html_url || repo.html_url,
        observedAt: event.created_at || new Date().toISOString(),
        fingerprint: await sha256("github|event|" + event.id),
        metadata: { eventId: event.id, eventType: event.type, repository: repo.full_name, action, pullRequest: pr?.number || 0 },
      });
    } else if (event.type === "ReleaseEvent" && event.payload?.release) {
      const release = event.payload.release;
      observations.push({
        source: "GitHub",
        type: "product",
        title: "Release published: " + (release.name || release.tag_name || repo.full_name),
        category: "Product / release",
        url: release.html_url || repo.html_url,
        observedAt: release.published_at || event.created_at || new Date().toISOString(),
        fingerprint: await sha256("github|release-event|" + (release.id || event.id)),
        metadata: { eventId: event.id, eventType: event.type, repository: repo.full_name, tag: release.tag_name || "" },
      });
    }
  }
  return { observations, error: null as string | null };
}

async function discoverGitHubOwners(domain: string | null): Promise<string[]> {
  if (!domain) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch("https://" + domain.replace(/^https?:\/\//, "").replace(/\/$/, ""), {
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
      headers: { "user-agent": "Opportunity-Intelligence/0.3 evidence-monitor", accept: "text/html,*/*" },
    });
    if (!response.ok) return [];
    const body = (await response.text()).slice(0, 180000);
    const owners = new Set<string>();
    const re = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)(?:[\/"?#]|$)/gi;
    for (const match of body.matchAll(re)) {
      const owner = match[1].trim();
      if (owner && !["features","marketplace","pricing","login","signup","about"].includes(owner.toLowerCase())) owners.add(owner);
    }
    return Array.from(owners).slice(0, 3);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function collectOwnerRepositories(owner: string) {
  const result = await githubFetch<GitHubRepo[]>(
    "/orgs/" + encodeURIComponent(owner) + "/repos?sort=updated&direction=desc&per_page=5",
  );
  if (result.data) return { repos: result.data, error: null as string | null };
  const user = await githubFetch<GitHubRepo[]>(
    "/users/" + encodeURIComponent(owner) + "/repos?sort=updated&direction=desc&per_page=5",
  );
  return user.data
    ? { repos: user.data, error: null as string | null }
    : { repos: [] as GitHubRepo[], error: "GitHub owner repositories unavailable" };
}

async function collectReleases(repo: GitHubRepo) {
  const result = await githubFetch<GitHubRelease[]>(
    "/repos/" + encodeURIComponent(repo.owner?.login || "") + "/" + encodeURIComponent(repo.name) + "/releases?per_page=3",
  );
  if (!result.data) return { observations: [] as Observation[], error: result.status === 403 ? "GitHub rate limit reached" : "GitHub releases unavailable" };

  const observations: Observation[] = [];
  for (const release of result.data) {
    if (release.draft) continue;
    observations.push({
      source: "GitHub",
      type: "product",
      title: "GitHub release: " + (release.name || release.tag_name),
      category: "Product / release",
      url: release.html_url,
      observedAt: release.published_at || new Date().toISOString(),
      fingerprint: await sha256("github|release|" + release.id),
      metadata: { releaseId: release.id, repository: repo.full_name, tag: release.tag_name, prerelease: Boolean(release.prerelease) },
    });
  }
  return { observations, error: null as string | null };
}

const githubAdapter = {
  id: "github",
  async collect(company: string): Promise<SignalAdapterResult> {
    const errors: string[] = [];
    const observations: Observation[] = [];

    const owners = await discoverGitHubOwners(domain);
    let repos: GitHubRepo[] = [];

    // Prefer an explicit GitHub link published by the company's own website.
    // This is stronger entity evidence than repository-name search.
    for (const owner of owners) {
      const result = await collectOwnerRepositories(owner);
      if (result.error) errors.push(owner + ": " + result.error);
      repos.push(...result.repos);
    }

    // Fall back to GitHub search only when the official site exposes no GitHub
    // identity. Search is more restrictive, so keep the fallback bounded.
    if (!repos.length) {
      const search = await githubFetch<{ items?: GitHubRepo[] }>(
        "/search/repositories?q=" + encodeURIComponent(company) + "&sort=updated&order=desc&per_page=10",
      );
      if (!search.data?.items) {
        if (search.status === 403) errors.push("GitHub rate limit reached");
        else errors.push("GitHub repository search unavailable");
        return { observations, errors };
      }
      repos = search.data.items.filter((repo) => likelyOwnedRepository(repo, company));
    }

    repos = repos
      .filter((repo) => !repo.archived && !repo.fork)
      .slice(0, 3);

    for (const repo of repos) observations.push(await observeRepo(repo));

    // Keep the public sensing adapter bounded: one discovery query and a small
    // amount of activity evidence per candidate repository.
    for (const repo of repos.slice(0, 2)) {
      const [events, releases] = await Promise.all([
        collectRepoEvents(repo),
        collectReleases(repo),
      ]);
      observations.push(...events.observations, ...releases.observations);
      if (events.error) errors.push(repo.full_name + ": " + events.error);
      if (releases.error) errors.push(repo.full_name + ": " + releases.error);
    }

    return {
      observations: Array.from(new Map(observations.map((item) => [item.fingerprint, item])).values()),
      errors: Array.from(new Set(errors)),
    };
  },
} satisfies {
  id: string;
  collect(company: string, domain: string | null): Promise<SignalAdapterResult>;
};

export { githubAdapter };
