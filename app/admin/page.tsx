"use client";

import { useEffect, useState } from "react";

type ConsoleData = {
  metrics: Record<string, number>;
  recentUsers: { email: string; plan: string; createdAt: string; updatedAt: string }[];
  locations: { location: string; count: number }[];
  recentRuns: { id: string; status: string; startedAt: string; finishedAt: string | null; observationCount: number; errorCount: number; company: { name: string } }[];
};

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [data, setData] = useState<ConsoleData | null>(null);
  const [pilots, setPilots] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [summaryCounts, setSummaryCounts] = useState({ missing: 0, stale: 0 });
  const [durationDays, setDurationDays] = useState("14");
  const [validityDays, setValidityDays] = useState("7");
  const [newCode, setNewCode] = useState("");
  const [message, setMessage] = useState("");
  const [scanBusy, setScanBusy] = useState<"discovery" | "monitor" | null>(null);
  const [scanProgress, setScanProgress] = useState("");
  const [scanResult, setScanResult] = useState<any>(null);

  async function load() {
    const r = await fetch("/api/admin/console", { cache: "no-store" });
    if (r.status === 401) { setLoggedIn(false); return; }
    const d = await r.json(); if (!r.ok) { setMessage(d.error || "Could not load admin console."); return; }
    setData(d); setLoggedIn(true);
    const [p, rv, cs] = await Promise.all([
      fetch("/api/admin/pilot").then(x => x.ok ? x.json() : null),
      fetch("/api/admin/review-tasks?status=open").then(x => x.ok ? x.json() : null),
      fetch("/api/admin/summaries").then(x => x.ok ? x.json() : null),
    ]);
    setPilots(p?.codes || []); setReviews(rv?.tasks || []);
    setCompanies([...(cs?.missing || []), ...(cs?.stale || [])]);
    setSummaryCounts(cs?.counts || { missing: 0, stale: 0 });
  }

  useEffect(() => { load(); }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault(); setMessage("");
    const r = await fetch("/api/admin/session", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ secret }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setMessage(d.error || "Admin login failed.");
    setSecret(""); await load();
  }

  async function logout() { await fetch("/api/admin/session", { method: "DELETE" }); setLoggedIn(false); setData(null); }

  async function createPilot(e: React.FormEvent) {
    e.preventDefault(); setNewCode(""); setMessage("");
    const r = await fetch("/api/admin/pilot", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({durationDays:Number(durationDays),validityDays:Number(validityDays)}) });
    const d=await r.json(); if(!r.ok) return setMessage(d.error||"Could not create pilot code.");
    setNewCode(d.code); await load();
  }

  async function triggerScan(kind: "discovery" | "monitor") {
    setScanBusy(kind); setScanResult(null); setMessage(""); setScanProgress("");
    try {
      const families = ["expansion", "procurement", "funding", "relationships", "regulatory", "financial", "operations"];
      if (kind === "discovery") {
        const runs: any[] = [];
        for (let i = 0; i < families.length; i++) {
          setScanProgress(`Discovery category ${i + 1} of ${families.length}: ${families[i]}`);
          const r = await fetch("/api/admin/discovery", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind, family: families[i] }),
          });
          const d = await r.json().catch(() => ({}));
          runs.push({ family: families[i], ...d });
          setScanResult({ kind, completed: i + 1, total: families.length, runs: [...runs] });
          // Continue through all categories; a single failed provider must not stop the rest.
        }
        const failed = runs.filter((run) => run.ok === false || (typeof run.status === "number" && run.status >= 400));
        if (failed.length) {
          setMessage("Discovery finished with " + failed.length + " failed categor" + (failed.length === 1 ? "y: " : "ies: ") + failed.map((run) => run.family).join(", ") + ". Other categories were still attempted.");
        }
      } else {
        setScanProgress("Refreshing watched companies…");
        const r = await fetch("/api/admin/discovery", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind }),
        });
        const d = await r.json().catch(() => ({}));
        setScanResult({ kind, ...d });
        if (!r.ok) throw new Error(d.error || `Could not start ${kind} scan (HTTP ${r.status})`);
      }
      setScanProgress("Scan completed.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scan request failed.");
    } finally {
      setScanBusy(null);
    }
  }

  async function resolve(id:string) {
    const r=await fetch("/api/admin/review-tasks",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({id,status:"resolved"})});
    if(r.ok) await load(); else setMessage("Could not resolve task.");
  }

  if (!loggedIn) return <main style={{maxWidth:520,margin:"80px auto",padding:24,fontFamily:"system-ui"}}><p style={{letterSpacing:2,fontWeight:800}}>HUNT / ADMIN</p><h1>Operations console</h1><p>Private administration for pilot access, evidence review, company summaries and product usage.</p><form onSubmit={login}><input autoFocus type="password" required value={secret} onChange={e=>setSecret(e.target.value)} placeholder="Admin credential" style={{width:"100%",padding:14,boxSizing:"border-box",marginBottom:12}}/><button type="submit" style={{padding:"12px 18px"}}>Enter admin console →</button></form>{message&&<p>{message}</p>}</main>;

  const m=data!.metrics;
  return <main style={{maxWidth:1200,margin:"30px auto",padding:24,fontFamily:"system-ui"}}>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:32}}><div><p style={{letterSpacing:2,fontWeight:800}}>HUNT / ADMIN</p><h1 style={{margin:"4px 0"}}>Operations console</h1></div><button onClick={logout}>Sign out</button></header>
    <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
      {Object.entries(m).map(([k,v])=><div key={k} style={{border:"1px solid #ddd",borderRadius:12,padding:16}}><small>{k.replace(/[A-Z]/g," $&")}</small><h2 style={{margin:"8px 0"}}>{v}</h2></div>)}
    </section>
    <section style={{border:"1px solid #ddd",borderRadius:12,padding:20,marginTop:24}}>
      <h2>Discovery &amp; monitoring</h2>
      <p>Run a scan on demand. Public discovery searches for new business evidence and stores candidates for review; watched-company monitoring refreshes existing watch-list companies.</p>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <button disabled={scanBusy!==null} onClick={()=>triggerScan("discovery")} style={{padding:"10px 14px"}}>{scanBusy==="discovery"?"Running public discovery…":"Run public discovery"}</button>
        <button disabled={scanBusy!==null} onClick={()=>triggerScan("monitor")} style={{padding:"10px 14px"}}>{scanBusy==="monitor"?"Running watched-company scan…":"Run watched-company scan"}</button>
      </div>
      {scanProgress&&<p aria-live="polite">{scanProgress}</p>}
      {scanResult&&<pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",background:"#f7f7f7",padding:12,borderRadius:8,marginTop:12,maxHeight:360,overflow:"auto"}}>{JSON.stringify(scanResult,null,2)}</pre>}
    </section>
    <section style={{border:"1px solid #ddd",borderRadius:12,padding:20,marginTop:24}}><h2>Company summaries</h2><p>{summaryCounts.missing} missing · {summaryCounts.stale} stale after new evidence</p>{companies.length===0?<p>All catalogue summaries are current.</p>:companies.slice(0,30).map(c=><div key={c.id} style={{borderTop:"1px solid #eee",padding:"10px 0"}}><b>{c.name}</b> · {c.generalSummary?"needs update":"needs summary"}{c.domain&&" · "+c.domain}<div><small>Evidence: {c.summaryEvidenceAt?new Date(c.summaryEvidenceAt).toLocaleDateString():"—"} · Summary: {c.summaryUpdatedAt?new Date(c.summaryUpdatedAt).toLocaleDateString():"—"}</small></div></div>)}</section>
    <section style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginTop:24}}>
      <div style={{border:"1px solid #ddd",borderRadius:12,padding:20}}><h2>Pilot codes</h2><form onSubmit={createPilot} style={{display:"flex",gap:8,flexWrap:"wrap"}}><input value={durationDays} onChange={e=>setDurationDays(e.target.value)} type="number" min="1" max="90" placeholder="access days"/><input value={validityDays} onChange={e=>setValidityDays(e.target.value)} type="number" min="1" max="30" placeholder="code validity"/><button>Create code</button></form>{newCode&&<p style={{fontFamily:"monospace",fontSize:24}}>New code: <b>{newCode}</b></p>}<p>Available: {m.pilotAvailable} · Redeemed: {m.pilotRedeemed}</p><div>{pilots.map(p=><div key={p.id} style={{padding:"8px 0",borderTop:"1px solid #eee"}}>{p.status} · {p.expiresAt?new Date(p.expiresAt).toLocaleDateString():"no expiry"}{p.redeemedBy?.email&&" · "+p.redeemedBy.email}</div>)}</div></div>
      <div style={{border:"1px solid #ddd",borderRadius:12,padding:20}}><h2>Review queue</h2>{reviews.length===0?<p>No open review tasks.</p>:reviews.map(t=><div key={t.id} style={{borderTop:"1px solid #eee",padding:"10px 0"}}><b>{t.title}</b><p>{t.company?.name||"Unknown"} · {t.detail}</p><button onClick={()=>resolve(t.id)}>Resolve</button></div>)}</div>
    </section>
    <section style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginTop:24}}>
      <div style={{border:"1px solid #ddd",borderRadius:12,padding:20}}><h2>Users</h2>{data!.recentUsers.map(u=><div key={u.email} style={{borderTop:"1px solid #eee",padding:"10px 0"}}>{u.email} · {u.plan} · joined {new Date(u.createdAt).toLocaleDateString()}</div>)}</div>
      <div style={{border:"1px solid #ddd",borderRadius:12,padding:20}}><h2>Where users are coming from</h2>{data!.locations.length?data!.locations.map(x=><div key={x.location} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderTop:"1px solid #eee"}}><span>{x.location}</span><b>{x.count}</b></div>):<p>Location data will appear after users sign in.</p>}</div>
    </section>
    <section style={{border:"1px solid #ddd",borderRadius:12,padding:20,marginTop:24}}><h2>Recent monitoring</h2>{data!.recentRuns.map(r=><div key={r.id} style={{borderTop:"1px solid #eee",padding:"10px 0"}}><b>{r.company.name}</b> · {r.status} · {r.observationCount} observations · {r.errorCount} errors</div>)}</section>
    {message&&<p>{message}</p>}
  </main>;
}
