export type HuntObjective = {
  profession?: string | null;
  services?: unknown;
  industries?: unknown;
  geography?: string | null;
  idealCustomer?: string | null;
  targetCompanies?: unknown;
  desiredSignals?: unknown;
  exclusions?: unknown;
  commercialObjectives?: unknown;
};

const asTerms = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase()).filter(Boolean)
    : typeof value === "string"
      ? value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)
      : [];

const tokenize = (value: string) =>
  value.toLowerCase().split(/[^a-z0-9+#.-]+/).filter((x) => x.length > 2);

function matchesTerms(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.filter((term) => lower.includes(term));
}

export function scoreCompanyRelevance(profile: HuntObjective, company: { name: string; country?: string | null; domain?: string | null }, observations: Array<{ title: string; category: string; source: string; url: string | null; observedAt: Date; metadata?: unknown }>) {
  const desired = [...asTerms(profile.desiredSignals), ...asTerms(profile.services), ...asTerms(profile.industries), ...asTerms(profile.commercialObjectives)];
  const exclusions = asTerms(profile.exclusions);
  const targetCompanies = asTerms(profile.targetCompanies);
  const companyText = [company.name, company.domain || "", company.country || ""].join(" ");
  const targetMatch = targetCompanies.some((x) => companyText.toLowerCase().includes(x));
  const rows = observations.map((o) => {
    const text = [o.title, o.category, o.source, JSON.stringify(o.metadata || {})].join(" ");
    const positive = matchesTerms(text, desired);
    const negative = matchesTerms(text, exclusions);
    const score = Math.max(0, Math.min(100, positive.length * 14 + (targetMatch ? 18 : 0) - negative.length * 25));
    return {
      title: o.title,
      category: o.category,
      source: o.source,
      url: o.url,
      observedAt: o.observedAt,
      score,
      matchedTerms: positive,
      excludedTerms: negative,
    };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || b.observedAt.getTime() - a.observedAt.getTime());

  const evidenceScore = rows.length ? Math.min(100, Math.round(rows.slice(0, 10).reduce((sum, x) => sum + x.score, 0) / Math.min(rows.length, 10) + Math.min(rows.length * 3, 15))) : 0;
  const confidence = rows.length >= 5 ? "strong" : rows.length >= 2 ? "moderate" : rows.length ? "weak" : "none";

  return {
    score: evidenceScore,
    confidence,
    targetCompany: targetMatch,
    evidenceCount: rows.length,
    evidence: rows.slice(0, 20),
    objective: {
      profession: profile.profession || null,
      services: asTerms(profile.services),
      industries: asTerms(profile.industries),
      desiredSignals: asTerms(profile.desiredSignals),
      exclusions,
      commercialObjectives: asTerms(profile.commercialObjectives),
    },
  };
}
