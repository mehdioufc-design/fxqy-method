"use client";
import { FormEvent, useState } from "react";
import { ArrowRight, Gauge, MonitorUp, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/client-api";
import { Brand } from "./brand";

export function OnboardingForm({ email }: { email: string }) {
  const [preset, setPreset] = useState("tiktok-safe"); const [performance, setPerformance] = useState("fast-hardware");
  const [captionGuides, setCaptionGuides] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await apiRequest("/api/settings", { method:"PUT", body:JSON.stringify({ defaultPreset:preset, performance, maxUploadBytes:2147483648, retentionHours:24, outputRetentionDays:30, enhancements:{ lanczos:true, captionGuides } }) });
      await apiRequest("/api/auth/onboarding", { method:"POST", body:"{}" }); window.location.assign("/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Preferences could not be saved."); setBusy(false); }
  }
  return <main className="onboarding-page"><header><Brand/><span>{email}</span></header><form className="onboarding-card panel" onSubmit={save}>
    <div className="onboarding-progress"><i/><span>One quick setup</span></div>
    <div><p className="eyebrow">Set your defaults</p><h1>How should your first export run?</h1><p>You can change these choices for each video or from Settings at any time.</p></div>
    <div className="onboarding-options">
      <fieldset><legend><MonitorUp size={18}/> Default export</legend><label className={preset==="tiktok-safe"?"selected":""}><input type="radio" name="preset" value="tiktok-safe" checked={preset==="tiktok-safe"} onChange={e=>setPreset(e.target.value)}/><span><b>TikTok Safe</b><small>Reliable 1080p/2K H.264 output.</small></span></label><label className={preset==="lossless-remux"?"selected":""}><input type="radio" name="preset" value="lossless-remux" checked={preset==="lossless-remux"} onChange={e=>setPreset(e.target.value)}/><span><b>Preserve original</b><small>Remux compatible files without re-encoding.</small></span></label></fieldset>
      <fieldset><legend><Gauge size={18}/> Processing speed</legend><label className={performance==="fast-hardware"?"selected":""}><input type="radio" name="performance" value="fast-hardware" checked={performance==="fast-hardware"} onChange={e=>setPerformance(e.target.value)}/><span><b>Fast Hardware</b><small>Use your GPU when supported.</small></span></label><label className={performance==="balanced"?"selected":""}><input type="radio" name="performance" value="balanced" checked={performance==="balanced"} onChange={e=>setPerformance(e.target.value)}/><span><b>Balanced</b><small>Prioritise consistent quality.</small></span></label></fieldset>
    </div>
    <label className="onboarding-check"><input type="checkbox" checked={captionGuides} onChange={e=>setCaptionGuides(e.target.checked)}/><ShieldCheck size={18}/><span><b>Show caption-safe preview guides</b><small>Helps keep important content away from TikTok interface overlays.</small></span></label>
    {error && <p className="inline-error">{error}</p>}<button className="button-primary onboarding-submit" disabled={busy}>{busy?<span className="spinner"/>:"Apply settings"}<ArrowRight size={17}/></button>
  </form></main>;
}
