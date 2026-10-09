"use client";
import { useEffect, useState } from "react";

export default function OAuthAuthorizePage() {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setQ(new URLSearchParams(window.location.search));
    fetch("/api/auth/me", { cache: "no-store" }).then(r => { if (r.ok) setSignedIn(true); }).catch(() => {});
  }, []);
  async function login(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setStatus("");
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const d = await r.json().catch(() => ({})); setBusy(false);
    if (!r.ok) { setStatus(d.error || "Sign in failed."); return; }
    setSignedIn(true); setPassword(""); setStatus("Signed in. Review the requested access below.");
  }
  async function authorize() {
    if (!q) return;
    setBusy(true); setStatus("");
    const body = Object.fromEntries(["client_id","redirect_uri","response_type","scope","state","code_challenge","code_challenge_method","resource"].map(k => [k, q.get(k) || ""]));
    const r = await fetch("/api/oauth/authorize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({})); setBusy(false);
    if (!r.ok) { setStatus(d.error || "Authorization failed."); return; }
    window.location.assign(d.redirect_to);
  }
  if (!q) return <main style={{padding:24}}>Loading secure authorization…</main>;
  return <main style={{maxWidth:620,margin:"8vh auto",padding:24,fontFamily:"system-ui,sans-serif",color:"#20201c"}}>
    <p style={{fontSize:12,letterSpacing:2,fontWeight:700}}>HUNT · SECURE CONNECTION</p>
    <h1 style={{fontSize:38,lineHeight:1.1}}>Connect your AI assistant</h1>
    <p style={{lineHeight:1.6,color:"#5d5d55"}}>Authorize this application to access Hunt company intelligence on your behalf. Your credentials are submitted only to Hunt.</p>
    <section style={{border:"1px solid #deded5",borderRadius:12,padding:20,marginTop:24}}>
      <div style={{fontSize:12,color:"#77776d"}}>REQUESTING APPLICATION</div><strong>{q.get("client_id") || "Unknown application"}</strong>
      <div style={{marginTop:18,fontSize:12,color:"#77776d"}}>PERMISSION</div>
      <p>Read company profiles, evidence, signals, contacts, financial records and opportunity information allowed by your Hunt plan.</p>
    </section>
    {!signedIn ? <form onSubmit={login} style={{marginTop:24,display:"grid",gap:12}}>
      <h2>Sign in to Hunt</h2>
      <label>Email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} style={{display:"block",boxSizing:"border-box",width:"100%",padding:12,marginTop:6}}/></label>
      <label>Password<input required type="password" value={password} onChange={e=>setPassword(e.target.value)} style={{display:"block",boxSizing:"border-box",width:"100%",padding:12,marginTop:6}}/></label>
      <button disabled={busy} style={{padding:13,border:0,borderRadius:8,background:"#24241f",color:"white"}}>{busy?"Signing in…":"Sign in to continue"}</button>
    </form> : <div style={{marginTop:24}}>
      <p>You are signed in. Approve only if you trust the application shown above.</p>
      <button disabled={busy} onClick={authorize} style={{padding:13,border:0,borderRadius:8,background:"#24241f",color:"white"}}>{busy?"Authorizing…":"Authorize Hunt access"}</button>
    </div>}
    {status && <p role="status" style={{padding:12,background:"#f4f3ed",borderRadius:8}}>{status}</p>}
    <p style={{marginTop:28,color:"#77776d",fontSize:12}}>Administrator credentials are never shared with user-connected AI clients. Access is limited by your Hunt plan.</p>
  </main>;
}
