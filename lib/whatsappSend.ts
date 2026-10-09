import { normalizePhone } from "./whatsapp";

/**
 * Server-side WhatsApp auto-send via a self-hosted OpenWA gateway
 * (https://github.com/rmyndharis/OpenWA).
 *
 * Design rules:
 * - Auto-send is OPT-IN. It only activates when OPENWA_URL, OPENWA_API_KEY
 *   and OPENWA_SESSION are all set. Until then every call is a safe no-op.
 * - Never throws. The booking/assignment flows must never break because of
 *   a messaging failure — callers treat the result as advisory.
 * - Recipient is built as <E164-digits>@c.us (OpenWA chat format).
 */

export function isWhatsAppAutoSendConfigured(): boolean {
  return Boolean(
    process.env.OPENWA_URL && process.env.OPENWA_API_KEY && process.env.OPENWA_SESSION
  );
}

export interface OpenwaSendResult {
  ok: boolean;
  skipped?: "not_configured" | "no_phone";
  error?: string;
}

export async function sendWhatsAppText(phone: string, message: string): Promise<OpenwaSendResult> {
  if (!isWhatsAppAutoSendConfigured()) {
    return { ok: false, skipped: "not_configured" };
  }

  const digits = normalizePhone(phone);
  if (!digits) {
    return { ok: false, skipped: "no_phone" };
  }

  const url = process.env.OPENWA_URL as string;
  const apiKey = process.env.OPENWA_API_KEY as string;
  const session = process.env.OPENWA_SESSION as string;

  try {
    const endpoint = `${url.replace(/\/$/, "")}/api/sessions/${encodeURIComponent(session)}/messages/send-text`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        chatId: `${digits}@c.us`,
        text: message,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `OpenWA HTTP ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "OpenWA request failed",
    };
  }
}

/** Send to a list of unique phones; returns how many succeeded, never throws. */
export async function sendWhatsAppMany(phoneToMessage: Array<{ phone: string; message: string }>): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = [];
  let sent = 0;
  for (const send of phoneToMessage) {
    const res = await sendWhatsAppText(send.phone, send.message);
    if (res.ok) sent += 1;
    else if (res.error) errors.push(res.error);
  }
  return { sent, errors };
}