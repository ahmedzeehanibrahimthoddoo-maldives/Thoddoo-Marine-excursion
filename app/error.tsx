"use client";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="section" style={{ minHeight: "60vh" }}>
      <div className="sectionHeading" style={{ textAlign: "center" }}>
        <h1>Something went wrong</h1>
      </div>
      <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
        <p style={{ marginBottom: 8 }}>
          We hit a temporary error while loading this page. Please try again — if it
          keeps happening, message us on WhatsApp and we&apos;ll get it fixed.
        </p>
        {error?.digest ? (
          <p style={{ fontSize: 13, opacity: 0.6 }}>Reference {error.digest}</p>
        ) : null}
        <div className="heroActions" style={{ justifyContent: "center" }}>
          <button type="button" className="primary" onClick={() => reset()}>
            Try again
          </button>
          <a className="secondary" href="/">
            Back to Home
          </a>
        </div>
      </div>
    </main>
  );
}