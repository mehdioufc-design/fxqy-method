"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Bug, MessageSquareText, Send, X } from "lucide-react";
import { apiRequest } from "@/lib/client-api";

export function FeedbackWidget(){
 const [open,setOpen]=useState(false),[kind,setKind]=useState<"bug"|"feedback">("feedback"),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[sent,setSent]=useState(false); const dialog=useRef<HTMLDivElement>(null);
 useEffect(()=>{const show=()=>setOpen(true);window.addEventListener("tto:request-feedback",show);return()=>window.removeEventListener("tto:request-feedback",show)},[]);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);await apiRequest("/api/feedback",{method:"POST",body:JSON.stringify({kind,message,page:window.location.pathname})});setBusy(false);setSent(true);setMessage("");}
 function close(){setOpen(false);setSent(false)}
 return <><button className="feedback-fab" onClick={()=>setOpen(true)}><MessageSquareText size={17}/> Feedback</button>{open&&<div className="feedback-scrim" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div className="feedback-dialog panel" role="dialog" aria-modal="true" aria-label="Report a bug or send feedback" ref={dialog}><button className="icon-button feedback-close" onClick={close} aria-label="Close"><X/></button>{sent?<div className="feedback-sent"><MessageSquareText/><h2>Thanks — it’s been sent.</h2><p>The developer can now see it in the feedback dashboard.</p><button className="button-primary" onClick={close}>Done</button></div>:<form onSubmit={submit}><p className="eyebrow">Help improve FXQY Method</p><h2>How did it go?</h2><div className="feedback-kind"><button type="button" className={kind==="feedback"?"active":""} onClick={()=>setKind("feedback")}><MessageSquareText/>Feedback</button><button type="button" className={kind==="bug"?"active":""} onClick={()=>setKind("bug")}><Bug/>Report a bug</button></div><label className="field"><span>{kind==="bug"?"What went wrong?":"What would make this better?"}</span><textarea className="input" minLength={5} maxLength={4000} value={message} onChange={e=>setMessage(e.target.value)} required placeholder="Include what you were doing and what you expected…"/></label><button className="button-primary" disabled={busy}><Send size={16}/>{busy?"Sending…":"Send privately"}</button></form>}</div></div>}</>;
}
