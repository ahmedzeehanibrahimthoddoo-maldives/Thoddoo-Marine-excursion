"use client";

import { useState } from "react";

type Kind = "booking" | "rental";

interface Result {
  type: "success" | "error";
  message: string;
}

export default function SendInvoiceButton({
  kind,
  id,
  email,
  onResult,
  title,
}: {
  kind: Kind;
  id: string;
  email?: string | null;
  onResult?: (r: Result) => void;
  title?: string;
}) {
  const [sending, setSending] = useState(false);
  const label = kind === "booking" ? "invoice" : "rental receipt";
  const buttonTitle = title || (kind === "booking" ? "Email invoice to guest" : "Email rental receipt to guest");

  async function post(to?: string): Promise<Response> {
    return fetch(`/api/admin/invoices/${kind}/${id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(to ? { email: to } : {}),
    });
  }

  async function send() {
    if (sending) return;
    setSending(true);
    try {
      let res = await post();
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; email?: string; error?: string; message?: string };

      if (!res.ok && body.error === "missing_recipient") {
        const typed = window.prompt(`No guest email on file for this ${label}. Enter an address to send it to:`, (email || "").trim());
        if (!typed || !typed.trim()) {
          onResult?.({ type: "error", message: `No ${label} sent — no email address.` });
          return;
        }
        res = await post(typed.trim());
      }

      const retryBody = (await res.json().catch(() => ({}))) as { ok?: boolean; email?: string; message?: string };
      if (res.ok && retryBody.ok) {
        onResult?.({ type: "success", message: `${label[0].toUpperCase() + label.slice(1)} emailed to ${retryBody.email}` });
        return;
      }
      onResult?.({ type: "error", message: retryBody.message || body.message || `Could not email the ${label}.` });
    } catch {
      onResult?.({ type: "error", message: `Could not email the ${label}.` });
    } finally {
      setSending(false);
    }
  }

  return (
    <button
      className="actionBtn"
      onClick={() => void send()}
      disabled={sending}
      title={buttonTitle}
    >
      {sending ? "…" : "✉"}
    </button>
  );
}
