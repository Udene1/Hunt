type EvidenceRow = {
  id: string; source: string; type: string; category: string; url: string | null;
  observedAt: Date; metadata?: unknown; sourceTier?: string | null;
  verificationStatus?: string | null; evidenceConfidence?: number | null;
};

function hostOf(url: string | null) {
  if (!url) return "";
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

export function sourceFamily(source: string, url?: string | null) {
  const s = source.toLowerCase();
  const host = hostOf(url || null);
  if (s.includes("remotive") || s.includes("arbeitnow") || s.includes("job")) return "jobs";
  if (s.includes("regulator") || /cbn|sec|cac|ndpc|nitda|fccpc/.test(s + " " + host)) return "regulatory";
  if (s.includes("github")) return "github";
  if (s.includes("procurement") || s.includes("etenders")) return "procurement";
  if (s.includes("certificate") || s.includes("crt.sh") || s.includes("certspotter")) return "technology";
  if (s.includes("official website") || s.includes("official company")) return "company";
  if (s.includes("public web")) return host ? "public-web:" + host : "public-web";
  if (s.includes("financial")) return "financial";
  return host ? "source:" + host : "source:" + s.replace(/\s+/g, "-");
}

function ageDays(at: Date, now: number) {
  return Math.max(0, (now - at.getTime()) / 86400000);
}

export function correlateEvidence(evidence: EvidenceRow[], options: { windowDays?: number; maxEvidence?: number } = {}) {
  const windowDays = options.windowDays ?? 14;
  const maxEvidence = options.maxEvidence ?? 24;
  const now = Date.now();
  const recent = evidence.filter((item) => ageDays(item.observedAt, now) <= windowDays)
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  const unique = Array.from(new Map(recent.map((item) => [item.id, item])).values()).slice(0, maxEvidence);
  const categories = Array.from(new Set(unique.map((item) => item.category).filter(Boolean)));
  const families = Array.from(new Set(unique.map((item) => sourceFamily(item.source, item.url))));
  const verified = unique.filter((item) => item.verificationStatus === "reachable" || item.verificationStatus === "verified").length;
  const fresh = unique.filter((item) => ageDays(item.observedAt, now) <= 7).length;
  if (unique.length < 2 || categories.length < 2 || families.length < 2) return null;
  const score = Math.min(99, 25 + Math.min(categories.length, 6) * 7 + Math.min(families.length, 6) * 7 + Math.min(verified, 6) * 3 + Math.min(fresh, 6) * 2);
  const fingerprint = [categories.slice().sort().join("|").toLowerCase(), families.slice().sort().join("|").toLowerCase()].join("::");
  return {
    score,
    headline: "Evidence intersection: " + categories.slice(0, 3).join(" + "),
    detail: unique.length + " observations across " + families.length + " independent source families and " + categories.length + " evidence categories within " + windowDays + " days.",
    categories, sourceFamilies: families, evidenceIds: unique.map((item) => item.id),
    windowStart: new Date(now - windowDays * 86400000), windowEnd: new Date(now), fingerprint,
  };
}
