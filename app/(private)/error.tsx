"use client";

import { AlertTriangle, ArrowLeft, RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function PrivateError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("A private workspace route failed to render.", error);
  }, [error]);

  return (
    <section className="route-error panel" role="alert">
      <span className="route-error-icon" aria-hidden="true"><AlertTriangle size={25} /></span>
      <p className="eyebrow">Workspace interrupted</p>
      <h2>This page did not finish loading</h2>
      <p>Your video files were not changed. Try the page again, or return to Create and continue from the local workspace.</p>
      <div className="route-error-actions">
        <button className="button-primary" type="button" onClick={reset}><RotateCw size={16} /> Try again</button>
        <Link className="button-secondary" href="/"><ArrowLeft size={16} /> Back to Create</Link>
      </div>
    </section>
  );
}
