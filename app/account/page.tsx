"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Profile = {
  profession?: string | null;
  services?: string[] | null;
  industries?: string[] | null;
  geography?: string | null;
  idealCustomer?: string | null;
  targetCompanies?: string[] | null;
  desiredSignals?: string[] | null;
  exclusions?: string[] | null;
  commercialObjectives?: string[] | null;
};

export default function AccountPage() {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<{ email: string; plan: string; pilotExpiresAt?: string | null } | null>(null);
  const [profile, setProfile] = useState<Profile>({});
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [pilotPin, setPilotPin] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then(async (r) => {
      if (!r.ok) return;
      const data = await r.json();
      setUser(data.user);
      setProfile(data.profile || {});
    }).catch(() => {});
  }, []);

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault();
    setStatus("");
    const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return setStatus(data.error || "Authentication failed.");
    setUser(data.user);
    setProfile(data.profile || {});
    setPassword("");
    setStatus("Signed in. Tell Hunt what you sell and what you want to detect.");
  }

  function listValue(value: unknown) {
    return Array.isArray(value) ? value.join(", ") : "";
  }

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setStatus("");
    const form = new FormData(e.currentTarget);
    const body = {
      profession: String(form.get("profession") || ""),
      services: String(form.get("services") || "").split(",").map((x) => x.trim()).filter(Boolean),
      industries: String(form.get("industries") || "").split(",").map((x) => x.trim()).filter(Boolean),
      geography: String(form.get("geography") || ""),
      idealCustomer: String(form.get("idealCustomer") || ""),
      targetCompanies: String(form.get("targetCompanies") || "").split(",").map((x) => x.trim()).filter(Boolean),
      desiredSignals: String(form.get("desiredSignals") || "").split(",").map((x) => x.trim()).filter(Boolean),
      exclusions: String(form.get("exclusions") || "").split(",").map((x) => x.trim()).filter(Boolean),
      commercialObjectives: String(form.get("commercialObjectives") || "").split(",").map((x) => x.trim()).filter(Boolean),
    };
    const r = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return setStatus(data.error || "Could not save profile.");
    setProfile(data.profile || {});
    setStatus("Profile saved. Hunt can now use these objectives for deterministic relevance matching.");
  }

  async function redeemPilot(e: React.FormEvent) {
    e.preventDefault();
    setRedeeming(true);
    setStatus("");
    const r = await fetch("/api/pilot/redeem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pilotPin }) });
    const data = await r.json().catch(() => ({}));
    setRedeeming(false);
    if (!r.ok) return setStatus(data.error || "Could not activate pilot.");
    setUser(data.user);
    setPilotPin("");
    setStatus("Pilot activated. Monitoring and watchlists are now enabled until " + new Date(data.user.pilotExpiresAt).toLocaleDateString() + ".");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setProfile({});
    setStatus("Signed out.");
  }

  return (
    <main style={{ maxWidth: 820 }}>
      <header>
        <Link href="/" style={{ color: "#171714", textDecoration: "none", fontWeight: 800 }}>← HUNT</Link>
        <div className="status"><i /> account</div>
      </header>

      {!user ? (
        <section className="hero" style={{ maxWidth: 620 }}>
          <p className="eyebrow">HUNT ACCOUNT</p>
          <h1 style={{ fontSize: 50 }}>{mode === "register" ? "Tell Hunt what you sell." : "Welcome back."}</h1>
          <p className="sub">Your profile becomes the deterministic commercial objective layer. Hunt stores evidence; your connected AI can investigate it.</p>
          <form className="card" onSubmit={submitAuth}>
            <label>Email<br /><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", padding: 12, margin: "8px 0 16px", border: "1px solid #d5d2c9", borderRadius: 8 }} /></label>
            <label>Password<br /><input required minLength={10} type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%", padding: 12, margin: "8px 0 16px", border: "1px solid #d5d2c9", borderRadius: 8 }} /></label>
            <button className="watch" type="submit">{mode === "register" ? "Create account →" : "Sign in →"}</button>
            <button type="button" className="refresh" style={{ marginLeft: 14 }} onClick={() => setMode(mode === "register" ? "login" : "register")}>{mode === "register" ? "Already have an account?" : "Create an account"}</button>
          </form>
          {status && <div className="why">{status}</div>}
        </section>
      ) : (
        <section className="hero" style={{ maxWidth: 760 }}>
          <div className="sectionHead"><div><p className="eyebrow">YOUR HUNT PROFILE</p><h1 style={{ fontSize: 46, margin: 0 }}>{user.email}</h1></div><button className="refresh" onClick={logout}>Sign out</button></div>
          <p className="sub">Plan: <strong>{user.plan}</strong>{user.pilotExpiresAt ? " · pilot expires " + new Date(user.pilotExpiresAt).toLocaleDateString() : ""}</p>
          {user.plan === "free" && (
            <form className="card" onSubmit={redeemPilot}>
              <p className="eyebrow">PILOT ACCESS</p>
              <h2>Have a pilot PIN?</h2>
              <p>PINs are activation codes only. Hunt exchanges a valid PIN for your authenticated pilot session; the PIN is not a permanent credential.</p>
              <input required inputMode="numeric" maxLength={8} value={pilotPin} onChange={(e) => setPilotPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="8-digit PIN" style={{ width: "100%", padding: 12, border: "1px solid #d5d2c9", borderRadius: 8, marginBottom: 12 }} />
              <button className="watch" type="submit">{redeeming ? "Activating…" : "Activate pilot →"}</button>
            </form>
          )}
          <form className="card" onSubmit={saveProfile}>
            <label>Profession / what you sell<input name="profession" defaultValue={profile.profession || ""} placeholder="Backend / infrastructure engineer" /></label>
            <label>Services<input name="services" defaultValue={listValue(profile.services)} placeholder="backend engineering, cloud reliability, security" /></label>
            <label>Industries<input name="industries" defaultValue={listValue(profile.industries)} placeholder="fintech, banking, SaaS" /></label>
            <label>Geography<input name="geography" defaultValue={profile.geography || ""} placeholder="Nigeria, West Africa" /></label>
            <label>Ideal customer<input name="idealCustomer" defaultValue={profile.idealCustomer || ""} placeholder="Fast-growing regulated fintechs" /></label>
            <label>Target companies<input name="targetCompanies" defaultValue={listValue(profile.targetCompanies)} placeholder="Flutterwave, Moniepoint" /></label>
            <label>Desired signals<input name="desiredSignals" defaultValue={listValue(profile.desiredSignals)} placeholder="infrastructure hiring, API changes, security changes" /></label>
            <label>Exclusions<input name="exclusions" defaultValue={listValue(profile.exclusions)} placeholder="generic marketing, internships" /></label>
            <label>Commercial objectives<textarea name="commercialObjectives" defaultValue={listValue(profile.commercialObjectives)} placeholder="Find companies with evidence of near-term backend or reliability demand" /></label>
            <button className="watch" type="submit">{saving ? "Saving…" : "Save commercial profile →"}</button>
          </form>
          {status && <div className="why">{status}</div>}
          <div className="panel dark"><p className="eyebrow">PRODUCT BOUNDARY</p><h2>Hunt does not make the commercial decision.</h2><p>Hunt observes public reality, preserves evidence and matches it against your stated objective. Your AI remains the investigator. No model API is embedded here.</p></div>
        </section>
      )}
    </main>
  );
}
