"use client";

import { useEffect, useMemo, useState } from "react";

type Company = {
  name: string;
  domain: string;
  description: string;
  sectors: string[];
  summary?: string | null;
};

type Monitor = {
  company: string;
  baseline: { observationCount: number; categories: string[]; established: boolean };
  change?: { detected: boolean | null; newObservationCount: number; unchangedObservationCount?: number; changedObservationCount?: number; previousObservationCount: number };
  signal: { score: number; headline: string; detail: string; commercialInterpretation: string } | null;
  observations: { source: string; title: string; category: string; url: string | null; observedAt: string }[];
  errors: string[];
  persistence?: { status: string; note: string };
};

type CompanyProfile = { company: { name: string; domain: string | null; country: string; summary: string | null }; contacts: { id: string; name: string; role: string; email: string | null; phone: string | null; linkedinUrl: string | null; source: string; sourceUrl: string | null; confidence: number; lastSeenAt: string }[]; financials: { id: string; period: string; statementType: string; currency: string | null; source: string; sourceUrl: string | null; publishedAt: string | null; summary: string | null; metrics: Record<string, unknown> | null; confidence: number }[]; };

type History = {
  persistent: boolean;
  observationCount: number;
  runCount: number;
  signalCount: number;
  runs: { id: string; startedAt: string; finishedAt: string | null; status: string; observationCount: number; errorCount: number }[];
  observations: { id: string; source: string; type: string; category: string; title: string; url: string | null; observedAt: string; firstSeenAt: string; lastSeenAt: string; metadata: unknown; status?: string; missCount?: number; lastProbeAt?: string | null; missingSince?: string | null; confirmedRemovedAt?: string | null }[];
  signals: { id: string; score: number; headline: string; detail: string; commercialInterpretation: string; createdAt: string; runId: string | null }[];
};

export default function Home() {
  const [q, setQ] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [watch, setWatch] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [monitor, setMonitor] = useState<Record<string, Monitor>>({});
  const [history, setHistory] = useState<Record<string, History>>({});
  const [profiles, setProfiles] = useState<Record<string, CompanyProfile>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);
  const [watchPersistent, setWatchPersistent] = useState(false);

  useEffect(() => {
    fetch("/api/companies").then((r) => r.json()).then((d) => setCompanies(d.companies || [])).catch(() => {});
    try { setWatch(JSON.parse(localStorage.getItem("hunt-watchlist") || "[]")); } catch {}
    fetch("/api/watch").then((r) => r.json()).then((d) => {
      if (d.persistent) {
        setWatchPersistent(true);
        setWatch((d.companies || []).map((c: Company) => c.name));
      } else if (d.code === "authentication_required" || d.code === "plan_required") {
        setWatch([]);
        localStorage.removeItem("hunt-watchlist");
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem("hunt-watchlist", JSON.stringify(watch));
  }, [watch]);

  useEffect(() => {
    const needle = q.trim();
    if (!needle) return;
    const timer = window.setTimeout(() => {
      fetch("/api/companies?q=" + encodeURIComponent(needle), { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setCompanies(d.companies || []))
        .catch(() => {});
    }, 220);
    return () => window.clearTimeout(timer);
  }, [q]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return companies;
    return companies.filter((c) => [c.name, c.domain, c.description, ...c.sectors].join(" ").toLowerCase().includes(needle));
  }, [companies, q]);

  async function loadProfile(company: string) {
    try {
      const r = await fetch("/api/company-profile?company=" + encodeURIComponent(target), { cache: "no-store" });
      const data = await r.json();
      if (r.ok) setProfiles((p) => ({ ...p, [company]: data }));
    } catch {}
  }

  async function loadHistory(company: string) {
    setHistoryLoading(company);
    try {
      const r = await fetch("/api/history?company=" + encodeURIComponent(company), { cache: "no-store" });
      const data = await r.json();
      if (r.ok) setHistory((h) => ({ ...h, [company]: data }));
      await loadProfile(company);
    } finally { setHistoryLoading(null); }
  }

  async function runMonitor(company: string) {
    const target = company.trim();
    if (!target) return;
    setLoading(target);
    setActive(target);
    try {
      const r = await fetch("/api/monitor?company=" + encodeURIComponent(company), { cache: "no-store" });
      const data = await r.json();
      if (r.status === 401 || r.status === 402) {
        window.location.href = "/account";
        return;
      }
      setMonitor((m) => ({ ...m, [target]: data }));
      await loadHistory(target);
    } finally { setLoading(null); }
  }

  async function toggleWatch(company: string) {
    const watching = watch.includes(company);
    if (watching) {
      setWatch((x) => x.filter((a) => a !== company));
      await fetch("/api/watch?company=" + encodeURIComponent(company), { method: "DELETE" }).catch(() => {});
      return;
    }
    setWatch((x) => [...x, company]);
    const r = await fetch("/api/watch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ company }),
    }).catch(() => null);
    if (r?.status === 401 || r?.status === 402) {
      setWatch((x) => x.filter((a) => a !== company));
      window.location.href = "/account";
      return;
    }
    if (r?.ok) {
      const data = await r.json().catch(() => ({}));
      if (data.persistent) setWatchPersistent(true);
    }
    void runMonitor(company);
  }

  async function openHistory(company: string) {
    setActive(company);
    if (!history[company]) await loadHistory(company);
  }

  return (
    <main>
      <header>
        <div className="brand">OPPORTUNITY<span>INTELLIGENCE</span></div>
        <div style={{display:"flex",gap:18,alignItems:"center"}}><a href="/account" style={{fontSize:12,color:"#171714",textDecoration:"none"}}>Account →</a><div className="status"><i /> evidence monitoring</div></div>
      </header>

      <section className="hero">
        <p className="eyebrow">THE COMMERCIAL SIGNAL LAYER</p>
        <h1>Watch companies.<br /><em>Find reasons to contact them.</em></h1>
        <p className="sub">We continuously collect public evidence around companies, detect meaningful changes, and turn independent observations into commercial signals.</p>
        <div className="search">
          <span>⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies, sectors or signals…" />
          <button onClick={() => setQ("")}>Clear</button>
        </div>
      </section>

      <section className="grid">
        <div>
          <div className="sectionHead">
            <h2>{q ? "Companies matching your search" : "Companies worth watching"}</h2>
            <span>{filtered.length} COMPANIES</span>
          </div>

          {q.trim() && filtered.length === 0 && (
            <article className="card">
              <div className="cardTop">
                <div><h3>Discover “{q.trim()}”</h3><strong>NOT IN HUNT YET</strong></div>
                <div className="score" style={{ fontSize: 14, fontWeight: 500 }}>NEW</div>
              </div>
              <p>This company is not in Hunt’s stored directory yet. Start an evidence scan and Hunt will register it, collect the available public signals, and preserve the first observation as its baseline.</p>
              <button className="watch" onClick={() => runMonitor(q.trim())}>
                {loading === q.trim() ? "Scanning…" : "Scan & register company →"}
              </button>
            </article>
          )}

          {filtered.map((company) => (
            <article key={company.name} className="card">
              <div className="cardTop">
                <div><h3>{company.name}</h3><strong>{company.sectors.slice(0, 3).join(" · ")}</strong></div>
                <div className="score" style={{ fontSize: 14, fontWeight: 500 }}>NG</div>
              </div>
              <p>{company.summary || company.description}</p>
              <div className="tags">{company.sectors.map((tag) => <span key={tag}>{tag}</span>)}</div>
              {monitor[company.name]?.signal && (
                <div className="why"><b>Latest detected signal · {monitor[company.name].signal!.score}</b>{monitor[company.name].signal!.headline} — {monitor[company.name].signal!.commercialInterpretation}</div>
              )}
              <button className="watch" onClick={() => toggleWatch(company.name)}>
                {watch.includes(company.name) ? "Watching · refresh evidence" : "Watch company →"}
              </button>
              {watch.includes(company.name) && (
                <>
                  <button className="refresh" style={{ marginLeft: 12 }} onClick={() => runMonitor(company.name)}>{loading === company.name ? "Scanning…" : "Scan now"}</button>
                  <button className="refresh" style={{ marginLeft: 8 }} onClick={() => openHistory(company.name)}>{historyLoading === company.name ? "Loading…" : "History"}</button>
                </>
              )}
            </article>
          ))}

          {active && (monitor[active] || history[active]) && (
            <section className="evidence">
              <div className="sectionHead">
                <h2>{active} · evidence history</h2>
                <div>
                  <button className="refresh" onClick={() => loadHistory(active)}>{historyLoading === active ? "Loading…" : "Reload history"}</button>
                  <button className="refresh" style={{ marginLeft: 8 }} onClick={() => runMonitor(active)}>{loading === active ? "Scanning…" : "Refresh scan"}</button>
                </div>
              </div>

              {history[active] && (
                <>
                  <div className="evidenceSummary">
                    <strong>{history[active].observationCount}</strong><span>stored observations</span>
                    <strong>{history[active].runCount}</strong><span>monitoring runs</span>
                    <strong>{history[active].signalCount}</strong><span>signals</span>
                  </div>

                  {history[active].signals[0] && (
                    <div className="why">
                      <b>Latest commercial signal · {history[active].signals[0].score}</b>
                      {history[active].signals[0].headline} — {history[active].signals[0].commercialInterpretation}
                    </div>
                  )}

                  <div className="sectionHead" style={{ marginTop: 24 }}>
                    <h2>Observation timeline</h2><span>{history[active].observations.length} STORED</span>
                  </div>
                  {history[active].observations.map((o) => (
                    <div className="observation" key={o.id}>
                      <span>{o.status === "confirmed_removed" ? "REMOVED" : o.status === "suspected_missing" ? "CHECKING" : o.source}</span>
                      <div><b>{o.title}</b><small>{o.category} · first seen {new Date(o.firstSeenAt).toLocaleDateString()} · last seen {new Date(o.lastSeenAt).toLocaleDateString()}{o.status === "confirmed_removed" && o.confirmedRemovedAt ? " · removed " + new Date(o.confirmedRemovedAt).toLocaleDateString() : ""}{o.status === "suspected_missing" ? " · miss " + (o.missCount || 1) + "/2" : ""}</small></div>
                      {o.url && <a href={o.url} target="_blank" rel="noreferrer">Evidence ↗</a>}
                    </div>
                  ))}

                  <div className="sectionHead" style={{ marginTop: 24 }}>
                    <h2>Run history</h2><span>{history[active].runs.length} RUNS</span>
                  </div>
                  {history[active].runs.map((r) => (
                    <div className="observation" key={r.id}>
                      <span>{r.status}</span>
                      <div><b>{new Date(r.startedAt).toLocaleString()}</b><small>{r.observationCount} observations · {r.errorCount} errors</small></div>
                    </div>
                  ))}
                </>
              )}

              {monitor[active]?.change?.detected && <div className="why"><b>Change detected</b>New evidence has appeared since the company's stored baseline.</div>}
              {monitor[active]?.errors.map((e) => <small className="error" key={e}>{e}</small>)}
              {monitor[active]?.persistence && <small className="error" style={{ color: "#777" }}>{monitor[active].persistence!.note}</small>}
            </section>
          )}
        </div>

        <aside>
          <div className="panel">
            <p className="eyebrow">WATCHLIST</p>
            <h2>{watch.length} companies</h2>
            <p>A watched company is not just saved. It becomes a monitored source of future evidence.</p>
            {!watch.length && <div className="empty">Watch a company to start its first evidence scan.</div>}
            {watch.map((w) => <button className="watchItem" key={w} onClick={() => openHistory(w)}>{w}<span>{history[w] ? "●" : "○"}</span></button>)}
            <small style={{ color: "#999" }}>{watchPersistent ? "Durable watchlist connected" : "Local watchlist · durable storage activates with DATABASE_URL"}</small>
          </div>
          <div className="panel dark">
            <p className="eyebrow">PRODUCT RULE</p>
            <h2>AI is the investigator.<br />Evidence is the product.</h2>
            <p>Jobs are only one adapter. The engine is being built to detect website, product, technology, security, funding, procurement and other public changes.</p>
          </div>
        </aside>
      </section>
    </main>
  );
}
