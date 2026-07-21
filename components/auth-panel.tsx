"use client";
import { FormEvent, useState } from "react";
import { ArrowRight, CheckCircle2, Film, LockKeyhole, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/client-api";
import { Brand } from "./brand";

export function AuthPanel() {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await apiRequest<{ needsOnboarding?: boolean }>(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify({ email, password }) });
      window.location.assign(result.needsOnboarding ? "/onboarding" : "/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your account could not be opened."); setBusy(false); }
  }
  return <main className="auth-page">
    <section className="auth-story">
      <Brand />
      <div><p className="eyebrow">Creator-grade video preparation</p><h1>Give every upload its best first impression.</h1>
      <p>Analyse, resize and export standards-compliant video with honest frame-rate handling and quality-first controls.</p></div>
      <div className="auth-benefits"><span><Film/><b>Real media analysis</b></span><span><Sparkles/><b>Quality-first exports</b></span><span><CheckCircle2/><b>Your own saved workflow</b></span></div>
    </section>
    <section className="auth-card panel">
      <div className="auth-tabs" role="tablist"><button className={mode === "signup" ? "active" : ""} onClick={()=>setMode("signup")}>Sign up</button><button className={mode === "login" ? "active" : ""} onClick={()=>setMode("login")}>Log in</button></div>
      <div><p className="eyebrow">{mode === "signup" ? "Create your workspace" : "Welcome back"}</p><h2>{mode === "signup" ? "Start optimizing" : "Log in to continue"}</h2><p>Your settings, videos and export history stay separated from other accounts.</p></div>
      <form onSubmit={submit} className="auth-form">
        <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label>
        <label className="field"><span>Password</span><input className="input" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 10 : 1} value={password} onChange={e=>setPassword(e.target.value)} required />{mode === "signup" && <small>Use at least 10 characters.</small>}</label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button className="button-primary auth-submit" disabled={busy}>{busy ? <span className="spinner"/> : <LockKeyhole size={17}/>} {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}<ArrowRight size={16}/></button>
      </form>
      <small className="auth-fineprint">FXQY Method does not connect to TikTok or control reach, moderation or recompression.</small>
    </section>
  </main>;
}
