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
  const [durationDays, setDurationDays] = useState("14");
  const [validityDays, setValidityDays] = useState("7");
  const [newCode, setNewCode] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const r = await fetch("/api/admin/console", { cache: "no-store" });
    if (r.status === 401) { setLoggedIn(false); return; }
    const d = await r.json(); if (!r.ok) { setMessage(d.error || "Could not load admin console."); return; }
    setData(d); setLoggedIn(true);
    const [p, rv, cs] = await Promise.all([
      fetch("/api/admin/pilot").then(x => x.ok ? x.json() : null),
      fetch("/api/admin/review-tasks?status=open").then(x => x.ok ? x.json() : null),
      fetch("/api/admin/company-summary?company=").then(x => x.json().catch(() => null)),
    ]);
    setPilots(p?.codes || []); setReviews(rv?.tasks || []);
    void cs;
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
