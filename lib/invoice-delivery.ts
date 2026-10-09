import { NextRequest } from "next/server";
import { GET as bookingInvoicePdf } from "@/app/api/admin/invoices/booking/[id]/pdf/route";
import { GET as rentalReceiptPdf } from "@/app/api/admin/invoices/rental/[id]/pdf/route";
import { sendEmail } from "@/lib/mail";
import { formatMoney, type Currency } from "@/lib/money";

export type InvoiceKind = "booking" | "rental";

export interface RenderedInvoice {
  bytes: Uint8Array;
  filename: string;
}

export interface RenderFailure {
  error: string;
  status: number;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase().slice(0, 60);
}

/**
 * Renders the invoice by calling the very same GET handler staff use for the
 * Download button, so an emailed invoice can never drift from the printed one.
 *
 * The nested call still runs inside this request's cookie scope, so the PDF
 * route's own auth checks pass unchanged.
 */
export async function renderInvoicePdf(
  kind: InvoiceKind,
  id: string,
  request: NextRequest,
): Promise<RenderedInvoice | RenderFailure> {
  const handler = kind === "booking" ? bookingInvoicePdf : rentalReceiptPdf;
  const url = new URL(
    kind === "booking"
      ? `/api/admin/invoices/booking/${id}/pdf`
      : `/api/admin/invoices/rental/${id}/pdf`,
    request.url,
  );
  url.searchParams.set("download", "1");

  let res: Response;
  try {
    res = await handler(new NextRequest(url, { method: "GET" }), {
      params: Promise.resolve({ id }),
    });
  } catch {
    return { error: "Failed to generate PDF", status: 500 };
  }

  if (!res.ok) {
    const detail = await res.json().catch(() => null) as { error?: string } | null;
    return { error: detail?.error || "Failed to generate PDF", status: res.status };
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const fallback = kind === "booking" ? `thoddoo-marine-invoice-${id.slice(0, 8)}.pdf` : `thoddoo-marine-rental-receipt-${id.slice(0, 8)}.pdf`;
  return { bytes, filename: sanitizeFilename(match?.[1] || fallback) || fallback };
}

export interface InvoiceEmailInput {
  to: string;
  kind: InvoiceKind;
  ref: string;
  guestName: string;
  currency: Currency;
  totalCents: number;
  paidCents: number;
  pdf: RenderedInvoice;
}

function invoiceHtml(input: InvoiceEmailInput, balance: number, label: string, salutation: string): string {
  const amountLine = balance > 0
    ? `<p style="margin:14px 0 0;font-size:15px">Amount outstanding: <strong>${formatMoney(balance, input.currency)}</strong></p>`
    : `<p style="margin:14px 0 0;font-size:15px">Paid in full — thank you.</p>`;
  return `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.5">
  <p>${salutation}</p>
  <p>Please find your ${label} <strong>${input.ref}</strong> attached as a PDF.</p>
  ${amountLine}
  <p style="margin-top:18px">Warm regards,<br/>Thoddoo Marine Excursion</p>
</body></html>`;
}

/** Sends the rendered PDF. Never throws — mirrors lib/mail.ts advisory style. */
export async function sendInvoiceEmail(
  input: InvoiceEmailInput,
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const balance = Math.max((input.totalCents || 0) - (input.paidCents || 0), 0);
  const label = input.kind === "booking" ? "invoice" : "rental receipt";
  const subject = `Thoddoo Marine ${label} ${input.ref}`.trim();
  const salutation = input.guestName ? `Dear ${input.guestName},` : "Dear guest,";

  return sendEmail({
    to: input.to,
    subject,
    text: `${salutation}\n\nPlease find your ${label} ${input.ref} attached as a PDF.\n\n${
      balance > 0 ? `Amount outstanding: ${formatMoney(balance, input.currency)}` : "Paid in full — thank you."
    }\n\nWarm regards,\nThoddoo Marine Excursion`,
    html: invoiceHtml(input, balance, label, salutation),
    attachments: [
      {
        filename: input.pdf.filename,
        contentBase64: Buffer.from(input.pdf.bytes).toString("base64"),
        contentType: "application/pdf",
      },
    ],
  });
}
