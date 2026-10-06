import { createHash } from "node:crypto";

export type FinancialMetricEvidence = {
  value: string;
  page: number | null;
  evidence: string;
  confidence: number;
  status: "verified" | "needs_review";
};

export type FinancialDocumentIssue = {
  type: "pdf_download_failed" | "pdf_extraction_failed" | "pdf_scanned" | "financial_period_ambiguous" | "financial_value_ambiguous";
  severity: "high" | "medium";
  title: string;
  detail: string;
  sourceUrl: string;
  fingerprint: string;
  metadata?: Record<string, unknown>;
};

export type FinancialDocumentExtraction = {
  sourceUrl: string;
  contentType: string | null;
  period: string | null;
  currency: string | null;
  statementType: string;
  metrics: Record<string, string | number | boolean>;
  metricEvidence: Record<string, FinancialMetricEvidence>;
  pages: Array<{ page: number; text: string }>;
  issues: FinancialDocumentIssue[];
  extracted: boolean;
};

const MAX_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 15000;

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function detectCurrency(text: string, url: string) {
  const haystack = text.slice(0, 25000) + " " + url;
  if (/(?:NGN|naira|₦|Naira)/i.test(haystack)) return "NGN";
  if (/(?:USD|US\\$|dollars?)/i.test(haystack)) return "USD";
  if (/(?:GBP|£|pounds?)/i.test(haystack)) return "GBP";
  if (/(?:EUR|€|euros?)/i.test(haystack)) return "EUR";
  return null;
}

function detectPeriod(text: string, url: string) {
  const heading = text.slice(0, 12000);
  const explicit = heading.match(/(?:year ended|for the year ended|financial year ended|year ending)[^\d]{0,80}(20\d{2})/i)?.[1];
  if (explicit) return explicit;
  const urlYear = url.match(/20\d{2}(?:[-/]20\d{2})?/i)?.[0];
  if (urlYear) return urlYear;
  const matches = heading.match(/20\d{2}(?:\s*[-/]\s*20\d{2})?/g) || [];
  const years = Array.from(new Set(matches.map(x => x.replace(/\s/g, ""))));
  return years.length === 1 ? years[0] : null;
}

function detectStatementType(text: string) {
  if (/quarterly|\\bQ[1-4]\\b/i.test(text)) return "quarterly";
  if (/interim results|half[- ]year|six months/i.test(text)) return "interim";
  if (/financial results|results for the year/i.test(text)) return "results";
  return "annual";
}

function extractMetrics(pages: Array<{ page: number; text: string }>) {
  const patterns: Array<[string, RegExp]> = [
    ["revenue", /(?:revenue|turnover)\s+(?:was|of|:)?\s*(?:₦|NGN|N|USD|US\\$|£|EUR|€)?\s*([0-9][0-9,]*(?:\\.[0-9]+)?(?:\s*(?:million|billion|m|bn|thousand|k))?)/i],
    ["netProfit", /(?:profit after tax|net profit|profit for the year)\s+(?:was|of|:)?\s*(?:₦|NGN|N|USD|US\\$|£|EUR|€)?\s*([0-9][0-9,]*(?:\\.[0-9]+)?(?:\s*(?:million|billion|m|bn|thousand|k))?)/i],
    ["grossProfit", /gross profit\s+(?:was|of|:)?\s*(?:₦|NGN|N|USD|US\\$|£|EUR|€)?\s*([0-9][0-9,]*(?:\\.[0-9]+)?(?:\s*(?:million|billion|m|bn|thousand|k))?)/i],
    ["assets", /total assets\s+(?:were|was|of|:)?\s*(?:₦|NGN|N|USD|US\\$|£|EUR|€)?\s*([0-9][0-9,]*(?:\\.[0-9]+)?(?:\\.[0-9]+)?(?:\s*(?:million|billion|m|bn|thousand|k))?)/i],
    ["liabilities", /total liabilities\s+(?:were|was|of|:)?\s*(?:₦|NGN|N|USD|US\\$|£|EUR|€)?\s*([0-9][0-9,]*(?:\\.[0-9]+)?(?:\s*(?:million|billion|m|bn|thousand|k))?)/i],
    ["cash", /(?:cash and cash equivalents|cash equivalents)\s+(?:were|was|of|:)?\s*(?:₦|NGN|N|USD|US\\$|£|EUR|€)?\s*([0-9][0-9,]*(?:\\.[0-9]+)?(?:\s*(?:million|billion|m|bn|thousand|k))?)/i],
    ["debt", /(?:total debt|borrowings|loans and borrowings)\s+(?:were|was|of|:)?\s*(?:₦|NGN|N|USD|US\\$|£|EUR|€)?\s*([0-9][0-9,]*(?:\\.[0-9]+)?(?:\s*(?:million|billion|m|bn|thousand|k))?)/i],
    ["equity", /(?:total equity|shareholders'? equity)\s+(?:was|were|of|:)?\s*(?:₦|NGN|N|USD|US\\$|£|EUR|€)?\s*([0-9][0-9,]*(?:\\.[0-9]+)?(?:\s*(?:million|billion|m|bn|thousand|k))?)/i],
    ["capex", /(?:capital expenditure|capex)\s+(?:was|of|:)?\s*(?:₦|NGN|N|USD|US\\$|£|EUR|€)?\s*([0-9][0-9,]*(?:\\.[0-9]+)?(?:\s*(?:million|billion|m|bn|thousand|k))?)/i],
  ];
  const evidence: Record<string, FinancialMetricEvidence> = {};
  const metrics: Record<string, string> = {};
  for (const [key, pattern] of patterns) {
    for (const page of pages) {
      const match = page.text.replace(/\s+/g, " ").match(pattern);
      if (!match) continue;
      const value = match[1].trim();
      if (/^20\d{2}$/.test(value)) continue;
      const idx = page.text.toLowerCase().indexOf(match[0].toLowerCase());
      const snippet = page.text.slice(Math.max(0, idx - 100), Math.min(page.text.length, idx + match[0].length + 120)).replace(/\s+/g, " ").trim();
      metrics[key] = value;
      evidence[key] = { value, page: page.page, evidence: snippet, confidence: 84, status: "verified" };
      break;
    }
  }
  return { metrics, evidence };
}

async function readPdfPages(buffer: Buffer) {
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = (pdfParseModule as any).default || pdfParseModule;
  const pages: Array<{ page: number; text: string }> = [];
  await pdfParse(buffer, {
    pagerender: async (pageData: any) => {
      const content = await pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      const text = content.items.map((item: any) => item.str || "").join(" ");
      const pageNumber = pages.length + 1;
      pages.push({ page: pageNumber, text: clean(text) });
      return text;
    },
  });
  return pages.filter(page => page.text.length > 0);
}

export async function extractFinancialDocument(sourceUrl: string): Promise<FinancialDocumentExtraction> {
  const issues: FinancialDocumentIssue[] = [];
  const base = {
    sourceUrl,
    contentType: null as string | null,
    period: null as string | null,
    currency: null as string | null,
    statementType: "annual",
    metrics: {} as Record<string, string | number | boolean>,
    metricEvidence: {} as Record<string, FinancialMetricEvidence>,
    pages: [] as Array<{ page: number; text: string }>,
    issues,
    extracted: false,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
      headers: { "user-agent": "Opportunity-Intelligence/0.3 financial-evidence-monitor" },
    });
    if (!response.ok) {
      const detail = "Financial document returned HTTP " + response.status + ".";
      issues.push({ type: "pdf_download_failed", severity: "high", title: "Financial PDF could not be downloaded", detail, sourceUrl, fingerprint: fingerprint("pdf_download_failed|" + sourceUrl + "|" + response.status) });
      return base;
    }
    const contentType = response.headers.get("content-type");
    base.contentType = contentType;
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_BYTES) {
      const detail = "Financial PDF exceeds Hunt's " + Math.round(MAX_BYTES / 1024 / 1024) + " MB extraction limit.";
      issues.push({ type: "pdf_extraction_failed", severity: "high", title: "Financial PDF is too large to extract", detail, sourceUrl, fingerprint: fingerprint("pdf_too_large|" + sourceUrl) });
      return base;
    }
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
      const detail = "Downloaded financial PDF exceeds Hunt's " + Math.round(MAX_BYTES / 1024 / 1024) + " MB extraction limit.";
      issues.push({ type: "pdf_extraction_failed", severity: "high", title: "Financial PDF is too large to extract", detail, sourceUrl, fingerprint: fingerprint("pdf_too_large|" + sourceUrl) });
      return base;
    }
    let pages: Array<{ page: number; text: string }>;
    try {
      pages = await readPdfPages(Buffer.from(arrayBuffer));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown PDF parser error.";
      issues.push({ type: "pdf_extraction_failed", severity: "high", title: "Financial PDF extraction failed", detail, sourceUrl, fingerprint: fingerprint("pdf_parse_failed|" + sourceUrl), metadata: { error: detail.slice(0, 500) } });
      return base;
    }
    base.pages = pages;
    const allText = pages.map(p => p.text).join(" ");
    if (allText.length < 120) {
      issues.push({ type: "pdf_scanned", severity: "high", title: "Financial PDF appears to be scanned or image-only", detail: "Hunt could not extract enough text from this document. No financial values were guessed.", sourceUrl, fingerprint: fingerprint("pdf_scanned|" + sourceUrl) });
      return base;
    }
    base.period = detectPeriod(allText, sourceUrl);
    base.currency = detectCurrency(allText, sourceUrl);
    base.statementType = detectStatementType(allText);
    if (!base.period) {
      issues.push({ type: "financial_period_ambiguous", severity: "medium", title: "Financial reporting period is ambiguous", detail: "Hunt extracted document text but could not confidently identify the reporting period.", sourceUrl, fingerprint: fingerprint("financial_period_ambiguous|" + sourceUrl) });
    }
    const extracted = extractMetrics(pages);
    base.metrics = extracted.metrics;
    base.metricEvidence = extracted.evidence;
    if (!Object.keys(base.metrics).length) {
      issues.push({ type: "financial_value_ambiguous", severity: "medium", title: "Financial PDF contains no confidently extractable headline metrics", detail: "Hunt found a financial document but did not identify any of the configured headline metrics. No zero values were inferred.", sourceUrl, fingerprint: fingerprint("financial_values_missing|" + sourceUrl) });
    }
    base.extracted = true;
    return base;
  } finally {
    clearTimeout(timeout);
  }
}
