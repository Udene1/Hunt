"use client";

import { useEffect, useMemo, useState } from "react";

type Company = {
  name: string;
  domain: string;
  description: string;
  sectors: string[];
};

type Monitor = {
  company: string;
  baseline: { observationCount: number; categories: string[]; established: boolean };
  change?: { detected: boolean | null; newObservationCount: number; previousObservationCount: number };
  signal: { score: number; headline: string; detail: string; commercialInterpretation: string } | null;
  observations: { source: string; title: string; category: string; url: string | null; observedAt: string }[];
  errors: string[];
  persistence?: { status: string; note: string };
};

export default function Home() {
  const [q, setQ] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [watch, setWatch] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [monitor, setMonitor] = useState<Record<string, Monitor>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [watchPersistent, setWatchPersistent] = useState(false);

  useEffect(() => {
    fetch("/api/companies")
      .then((r) => r.json())
      .then((d) => setCompanies(d.companies || []))
      .catch(() => {});
    try {
      setWatch(JSON.parse(localStorage.getItem("hunt-watchlist") || "[]"));
    } catch {}
    fetch("/api/watch")
      .then((r) => r.json())
      .then((d) => {
        if (d.persistent) {
          setWatchPersistent(true);
          setWatch((d.companies || []).map((c: Company) => c.name));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem("hunt-watchlist", JSON.stringify(watch));
  }, [watch]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return companies;
    return companies.filter((c) =>
      [c.name, c.domain, c.description, ...c.sectors].join(" ").toLowerCase().includes(needle)
    );
  }, [companies, q]);

  async function runMonitor(company: string) {
    setLoading(company);
    setActive(company);
    try {
      const r = await fetch("/api/monitor?company=" + encodeURIComponent(company), { cache: "no-store" });
      const data = await r.json();
      setMonitor((m) => ({ ...m, [company]: data }));
    } finally {
      setLoading(null);
    }
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

    if (r?.ok) {
      const data = await r.json().catch(() => ({}));
      if (data.persistent) setWatchPersistent(true);
    }
    void runMonitor(company);
  }

  return (
    <main>
      <header>
        <div className="brand">OPPORTUNITY<span>INTELLIGENCE</span></div>
        <div className="status"><i /> evidence monitoring</div>
      </header>

      <section className="hero">
        <p className="eyebrow">THE COMMERCIAL SIGNAL LAYER</p>
        <h1>Watch companies.<br /><em>Find reasons to contact them.</em></h1>
        <p className="sub">
          We continuously collect public evidence around companies, detect meaningful changes,
          and turn independent observations into commercial signals.
        </p>
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

          {filtered.map((company) => (
            <article key={company.name} className="card">
              <div className="cardTop">
                <div>
                  <h3>{company.name}</h3>
                  <strong>{company.sectors.slice(0, 3).join(" · ")}</strong>
                </div>
                <div className="score" style={{ fontSize: 14, fontWeight: 500 }}>NG</div>
              </div>
              <p>{company.description}</p>
              <div className="tags">
                {company.sectors.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
              {monitor[company.name]?.signal && (
                <div className="why">
                  <b>Latest detected signal · {monitor[company.name].signal!.score}</b>
                  {monitor[company.name].signal!.headline} — {monitor[company.name].signal!.commercialInterpretation}
                </div>
              )}
              <button className="watch" onClick={() => toggleWatch(company.name)}>
                {watch.includes(company.name) ? "Watching · refresh evidence" : "Watch company →"}
              </button>
              {watch.includes(company.name) && (
                <button className="refresh" style={{ marginLeft: 12 }} onClick={() => runMonitor(company.name)}>
                  {loading === company.name ? "Scanning…" : "Scan now"}
                </button>
              )}
            </article>
          ))}

          {active && monitor[active] && (
            <section className="evidence">
              <div className="sectionHead">
                <h2>{active} · evidence history</h2>
                <button className="refresh" onClick={() => runMonitor(active)}>
                  {loading === active ? "Scanning…" : "Refresh scan"}
                </button>
              </div>

              <div className="evidenceSummary">
                <strong>{monitor[active].baseline.observationCount}</strong>
                <span>current observations</span>
                <strong>{monitor[active].change?.newObservationCount ?? 0}</strong>
                <span>new since baseline</span>
              </div>

              {monitor[active].change?.detected && (
                <div className="why">
                  <b>Change detected</b>
                  New evidence has appeared since the company's stored baseline.
                </div>
              )}

              {monitor[active].signal && (
                <div className="why">
                  <b>Commercial interpretation</b>
                  {monitor[active].signal!.commercialInterpretation}
                </div>
              )}

              {monitor[active].observations.map((o, i) => (
                <div className="observation" key={o.source + "-" + o.title + "-" + i}>
                  <span>{o.source}</span>
                  <div>
                    <b>{o.title}</b>
                    <small>{o.category} · {new Date(o.observedAt).toLocaleDateString()}</small>
                  </div>
                  {o.url && <a href={o.url} target="_blank" rel="noreferrer">Evidence ↗</a>}
                </div>
              ))}

              {monitor[active].errors.map((e) => <small className="error" key={e}>{e}</small>)}
              {monitor[active].persistence && (
                <small className="error" style={{ color: "#777" }}>
                  {monitor[active].persistence!.note}
                </small>
              )}
            </section>
          )}
        </div>

        <aside>
          <div className="panel">
            <p className="eyebrow">WATCHLIST</p>
            <h2>{watch.length} companies</h2>
            <p>
              A watched company is not just saved. It becomes a monitored source of future evidence.
            </p>
            {!watch.length && <div className="empty">Watch a company to start its first evidence scan.</div>}
            {watch.map((w) => (
              <button className="watchItem" key={w} onClick={() => runMonitor(w)}>
                {w}<span>{loading === w ? "…" : "●"}</span>
              </button>
            ))}
            <small style={{ color: "#999" }}>
              {watchPersistent ? "Durable watchlist connected" : "Local watchlist · durable storage activates with DATABASE_URL"}
            </small>
          </div>

          <div className="panel dark">
            <p className="eyebrow">PRODUCT RULE</p>
            <h2>AI is the investigator.<br />Evidence is the product.</h2>
            <p>
              Jobs are only one adapter. The engine is being built to detect website,
              product, technology, security, funding, procurement and other public changes.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
