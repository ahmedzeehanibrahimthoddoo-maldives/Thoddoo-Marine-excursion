/**
 * Server-side transactional email via Resend (https://resend.com).
 *
 * Design rules (mirrors lib/whatsappSend.ts):
 * - Auto-send is OPT-IN. It only activates when RESEND_API_KEY is set.
 *   Until then every call is a safe no-op.
 * - Never throws. Bookings/assignments must never break because of a
 *   messaging failure — callers treat the result as advisory.
 * - From is configurable via RESEND_FROM and must sit on the verified
 *   Resend sending domain (root or subdomain) chosen at account setup.
 */

export function isEmailAutoSendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export interface ResendSendResult {
  ok: boolean;
  skipped?: "not_configured" | "no_recipient";
  error?: string;
}

export interface EmailAttachment {
  /** File name shown on the email (e.g. "thoddoo-marine-consent-ob1abc.pdf"). */
  filename: string;
  /** Raw PDF/bytes content encoded as base64 (Resend `content`). */
  contentBase64: string;
  /** Optional: default is application/pdf. */
  contentType?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export async function sendEmail(message: EmailMessage): Promise<ResendSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, skipped: "not_configured" };
  }

  const to = message.to.trim();
  if (!to || !to.includes("@")) {
    return { ok: false, skipped: "no_recipient" };
  }

  const from = process.env.RESEND_FROM || "Thoddoo Marine <no-reply@send.thoddoomarineexcursion.com>";
  const replyTo = message.replyTo || process.env.RESEND_REPLY_TO || "booking@thoddoomarineexcursion.com";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        reply_to: replyTo,
        attachments: message.attachments?.length
          ? message.attachments.map((a) => ({
              filename: a.filename,
              content: a.contentBase64,
              content_type: a.contentType || "application/pdf",
            }))
          : undefined,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Resend HTTP ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Resend request failed",
    };
  }
}