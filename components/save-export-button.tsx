"use client";

import { Download } from "lucide-react";
import { useState } from "react";

type WritableFile = { write(data: Blob): Promise<void>; close(): Promise<void> };
type SaveHandle = { createWritable(): Promise<WritableFile> };

export function SaveExportButton({ url, fileName, className = "button-primary", label = "Save video" }: { url: string; fileName: string; className?: string; label?: string }) {
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) throw new Error("The export could not be downloaded.");
      const blob = await response.blob();
      const picker = (window as typeof window & { showSaveFilePicker?: (options: unknown) => Promise<SaveHandle> }).showSaveFilePicker;
      if (picker) {
        const handle = await picker({ suggestedName: fileName, types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }] });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = fileName;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      }
      window.setTimeout(() => window.dispatchEvent(new Event("tto:request-feedback")), 700);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        window.alert(error instanceof Error ? error.message : "The export could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  return <button type="button" className={className} onClick={() => void save()} disabled={saving}><Download size={16} />{saving ? "Preparing…" : label}</button>;
}
