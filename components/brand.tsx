import { Clapperboard } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="FXQY Method">
      <span className="brand-mark" aria-hidden="true">
        <Clapperboard size={compact ? 18 : 21} strokeWidth={1.8} />
        <i />
      </span>
      {!compact && (
        <span className="brand-copy">
          <strong>FXQY Method</strong>
          <small>Creator video optimizer</small>
        </span>
      )}
    </div>
  );
}
