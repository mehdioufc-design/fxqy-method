export default function PrivateLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite" aria-label="Loading workspace">
      <div className="route-loading-hero">
        <span className="skeleton-line skeleton-kicker" />
        <span className="skeleton-line skeleton-title" />
        <span className="skeleton-line skeleton-copy" />
      </div>
      <div className="route-loading-grid">
        <span /><span /><span />
      </div>
      <span className="sr-only">Loading your local workspace…</span>
    </div>
  );
}
