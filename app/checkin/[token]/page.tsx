export const dynamic = "force-static";

export default function ObsoleteCheckinPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        fontFamily: "Arial, Helvetica, sans-serif",
        padding: "1.5rem 1rem 3rem",
      }}
    >
      <div
        style={{
          maxWidth: 700,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 18,
          boxShadow: "0 4px 24px rgba(7,57,111,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg, var(--navy), var(--blue))",
            color: "#fff",
            padding: "2rem 2rem 1.5rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.4rem", margin: 0, fontWeight: 800 }}>
            Link Updated
          </h1>
        </div>
        <div style={{ padding: "1.5rem 2rem 2rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.95rem", color: "var(--ink)", marginBottom: "1rem" }}>
            This check-in link format is no longer supported.
          </p>
          <p style={{ fontSize: "0.85rem", color: "#6b7c8d" }}>
            Please ask Thoddoo Marine staff for a new QR code.
          </p>
        </div>
      </div>
    </main>
  );
}
