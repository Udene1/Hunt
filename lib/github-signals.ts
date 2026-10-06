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
  // Hunt is an evidence system: a third-party SDK mentioning a company is not
  // evidence of that company's own GitHub activity. Prefer an owner identity
  // that maps directly to the company before collecting repository activity.
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
