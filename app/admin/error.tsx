"use client";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Something went wrong</h1>
      </div>
      <div className="errorState">
        <p>Unable to load this page. This is usually a temporary connection issue.</p>
        {error?.digest ? <p className="textMuted">Reference {error.digest}</p> : null}
        <button className="addBtn" onClick={() => reset()}>Try again</button>
        <span style={{ marginLeft: 8 }}>
          <a className="actionBtn" href="/admin">Go to Dashboard</a>
        </span>
      </div>
    </div>
  );
}