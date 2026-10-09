"use client";

import { useState, useEffect } from "react";
import CheckinClient from "./[token]/CheckinClient";

function isValidHexToken(t: string): boolean {
  return /^[0-9a-f]{64}$/i.test(t);
}

export default function CheckinHashPage() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/^#token=([0-9a-fA-F]+)/);
    if (!match || !match[1]) {
      setError("missing");
      return;
    }
    const raw = match[1];
    if (!isValidHexToken(raw)) {
      setError("invalid");
      return;
    }

    window.history.replaceState(null, "", window.location.pathname);
    setToken(raw);
  }, []);

  if (error === "missing") {
    return (
      <main style={pageStyles.page}>
        <div style={pageStyles.card}>
          <div style={pageStyles.header}>
            <h1 style={pageStyles.headerH1}>Check-in</h1>
          </div>
          <div style={{ ...pageStyles.body, textAlign: "center" }}>
            <p style={{ fontSize: "0.95rem", color: "var(--ink)", marginBottom: "1rem" }}>
              Please scan the Thoddoo Marine QR code to begin check-in.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (error === "invalid") {
    return (
      <main style={pageStyles.page}>
        <div style={pageStyles.card}>
          <div style={pageStyles.header}>
            <h1 style={pageStyles.headerH1}>Invalid Link</h1>
          </div>
          <div style={{ ...pageStyles.body, textAlign: "center" }}>
            <p style={{ fontSize: "0.95rem", color: "var(--ink)", marginBottom: "1rem" }}>
              This check-in link is invalid or has expired. Please ask staff for a new QR code.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!token) {
    return (
      <main style={pageStyles.page}>
        <div style={pageStyles.card}>
          <div style={{ ...pageStyles.body, textAlign: "center", padding: "3rem 2rem" }}>
            <p style={{ fontSize: "0.95rem", color: "#6b7c8d" }}>Loading...</p>
          </div>
        </div>
      </main>
    );
  }

  return <CheckinClient token={token} />;
}

const pageStyles = {
  page: {
    minHeight: "100vh",
    background: "var(--bg)",
    fontFamily: "Arial, Helvetica, sans-serif",
    padding: "1.5rem 1rem 3rem",
  },
  card: {
    maxWidth: 700,
    margin: "0 auto",
    background: "#fff",
    borderRadius: 18,
    boxShadow: "0 4px 24px rgba(7,57,111,0.08)",
    overflow: "hidden",
  },
  header: {
    background: "linear-gradient(135deg, var(--navy), var(--blue))",
    color: "#fff",
    padding: "2rem 2rem 1.5rem",
    textAlign: "center" as const,
  },
  headerH1: {
    fontSize: "1.4rem",
    margin: 0,
    fontWeight: 800,
  },
  body: {
    padding: "1.5rem 2rem 2rem",
  },
};
