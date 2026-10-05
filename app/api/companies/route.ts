import { NextResponse } from "next/server";
import { COMPANY_CATALOG } from "@/lib/companies";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() || "";
  const companies = COMPANY_CATALOG.filter((c) => {
    if (!q) return true;
    return [c.name, c.domain, c.description, ...c.sectors].join(" ").toLowerCase().includes(q);
  });
  return NextResponse.json({ companies });
}
