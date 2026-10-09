/**
 * Server-side email copy delivery for guests.
 *
 * Two sends, both authorized purely by the unguessable signing token
 * (the same token used to sign — no staff login required):
 *   - consent copy   → the official consent & liability waiver PDF
 *   - rental receipt → the rental receipt PDF (sent once a rental is returned)
 *
 * Everything is advisory and opt-in through lib/mail.ts: without
 * RESEND_API_KEY these are safe no-ops. Never throws.
 */

import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/mail";
import { generateConsentPdf, type ConsentPdfData } from "@/lib/consent-pdf";
import {
  generateRentalReceiptPdf,
  type RentalReceiptPdfData,
} from "@/lib/invoice-pdf";
import type { Currency } from "@/lib/money";

const TOKEN_RE = /^[A-Za-z0-9-]{8,200}$/;

export interface GuestCopyResult {
  ok: boolean;
  skipped?: "not_configured" | "no_recipient";
  error?: string;
}

function safeRef(value: string | null | undefined, fallback: string): string {
  return (
    (value || "")
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .toLowerCase()
      .slice(0, 40) || fallback
  );
}

function subjectLine(guestName: string | null | undefined, prefix: string): string {
  return `${prefix} — ${(guestName || "Guest").trim()}`;
}

// Branded message shell with the approved Thoddoo Marine signature block.
function htmlMessage(body: string): string {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#18303f;font-size:14px;line-height:1.55">
    ${body}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px;max-width:480px">
      <tr>
        <td style="width:64px;vertical-align:top" rowspan="2">
          <img src="https://thoddoomarineexcursion.com/images/logo-transparent.png"
               alt="Thoddoo Marine" width="56" height="56"
               style="display:block;border-radius:10px" />
        </td>
        <td style="font-size:16px;font-weight:bold;color:#07396f;padding:2px 0 0 12px">
          Thoddoo Marine Excursion Centre
        </td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#4a6277;padding:2px 0 0 12px">
          Thoddoo, Maldives &middot; <a href="https://thoddoomarineexcursion.com" style="color:#0ea7c7;text-decoration:none">thoddoomarineexcursion.com</a><br/>
          <span style="white-space:nowrap">WhatsApp +960 947 2110</span> &middot; <span style="white-space:nowrap">+62 813 5374 8031</span><br/>
          Golden sand, turquoise lagoon &mdash; book your adventure with us.
        </td>
      </tr>
    </table>
  </div>`;
}

function textSignature(): string {
  return `
--
Thoddoo Marine Excursion Centre
Thoddoo, Maldives
Web: thoddoomarineexcursion.com
WhatsApp: +960 947 2110 / +62 813 5374 8031
Golden sand, turquoise lagoon — book your adventure with us.`;
}

// ---------------------------------------------------------------
// Consent copy email
// ---------------------------------------------------------------

export async function sendConsentCopyEmail(token: string): Promise<GuestCopyResult> {
  if (!TOKEN_RE.test(token)) {
    return { ok: false, error: "invalid_token" };
  }

  const supabase = await createClient();
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "get_consent_pdf_by_token",
    { p_token: token },
  );
  if (rpcError) {
    return { ok: false, error: rpcError.message };
  }
  if (!rpcData || typeof rpcData !== "object" || "error" in (rpcData as object)) {
    return { ok: false, error: "consent_not_available" };
  }

  const consent = rpcData as unknown as ConsentPdfData & { email?: string | null };
  const to = (consent.email || "").trim();
  if (!to || !to.includes("@")) {
    return { ok: false, skipped: "no_recipient" };
  }

  if (!consent.signature_data_url) {
    return { ok: false, error: "consent_has_no_signature" };
  }

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateConsentPdf(consent, null);
  } catch {
    return { ok: false, error: "pdf_generation_failed" };
  }

  const ref = safeRef(consent.booking_ref, consent.id.slice(0, 8));
  const guestName = consent.guest_name || "Guest";
  const body = `
    <p>Hello <strong>${guestName.replace(/</g, "&lt;")}</strong>,</p>
    <p>Thank you for signing your activity consent &amp; liability waiver${
      consent.activity_name ? ` for <strong>${consent.activity_name}</strong>` : ""
    } with Thoddoo Marine. Your official signed PDF copy is attached to this email.</p>
    <p>Signing reference: ${ref}. Please keep this copy for your records.</p>
    <p style="margin-bottom:0">We look forward to seeing you out on the water!</p>`;

  return sendEmail({
    to,
    subject: subjectLine(guestName, "Your signed consent & liability waiver"),
    html: htmlMessage(body),
    text: `Hello ${guestName},\n\nThank you for signing your activity consent & liability waiver${consent.activity_name ? ` for ${consent.activity_name}` : ""} with Thoddoo Marine. Your official signed PDF copy is attached to this email.\n\nSigning reference: ${ref}. Please keep this copy for your records.\n\nWe look forward to seeing you out on the water!${textSignature()}`,
    attachments: [
      {
        filename: `thoddoo-marine-consent-${ref}-copy.pdf`,
        contentBase64: pdfBuffer.toString("base64"),
      },
    ],
  });
}

// ---------------------------------------------------------------
// Rental receipt email (sent once the rental is returned)
// ---------------------------------------------------------------

export async function sendRentalReceiptEmail(token: string): Promise<GuestCopyResult> {
  if (!TOKEN_RE.test(token)) {
    return { ok: false, error: "invalid_token" };
  }

  const supabase = await createClient();
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "get_rental_receipt_by_token",
    { p_token: token },
  );
  if (rpcError) {
    return { ok: false, error: rpcError.message };
  }
  if (!rpcData || typeof rpcData !== "object" || "error" in (rpcData as object)) {
    return { ok: false, error: "receipt_not_available" };
  }

  const receipt = rpcData as unknown as {
    rental_id: string;
    checked_out_at: string | null;
    expected_return_at: string | null;
    returned_at: string | null;
    rental_charge_cents: number;
    deposit_cents: number;
    additional_charges_cents: number;
    currency: string;
    payment_status: string | null;
    equipment: { name: string | null; asset_number: string | null };
    customers: {
      full_name: string | null;
      phone: string | null;
      hotel: string | null;
      room_number: string | null;
    };
    email: string | null;
    total_paid_cents: number;
    payments: Array<{
      id: string;
      created_at: string | null;
      method: string | null;
      reference: string | null;
      amount_cents: number;
      converted_amount_cents: number | null;
      currency: string | null;
      status: string | null;
    }>;
  };

  const to = (receipt.email || "").trim();
  if (!to || !to.includes("@")) {
    return { ok: false, skipped: "no_recipient" };
  }

  const currency: Currency = receipt.currency === "MVR" ? "MVR" : "USD";
  const completed = (receipt.payments || []).filter((p) => String(p.status) === "completed");
  const lastPayment = [...completed].sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || "")),
  )[0];
  // Deposit excluded: it is a refundable hold, and create_rental_payment never
  // accepts money against it.
  const payableTotal = Math.round(
    (Number(receipt.rental_charge_cents) || 0) +
      (Number(receipt.additional_charges_cents) || 0),
  );
  const totalPaid = Math.round(Number(receipt.total_paid_cents) || 0);

  const receiptData: RentalReceiptPdfData = {
    rental_id: String(receipt.rental_id),
    customer_name: String(receipt.customers?.full_name || "—"),
    phone: String(receipt.customers?.phone || ""),
    hotel: String(receipt.customers?.hotel || ""),
    room_number: String(receipt.customers?.room_number || ""),
    equipment_name: String(receipt.equipment?.name || "—"),
    asset_number: String(receipt.equipment?.asset_number || ""),
    checked_out_at: String(receipt.checked_out_at || ""),
    expected_return_at: String(receipt.expected_return_at || ""),
    returned_at: String(receipt.returned_at || ""),
    rental_charge_cents: Math.round(Number(receipt.rental_charge_cents) || 0),
    deposit_cents: Math.round(Number(receipt.deposit_cents) || 0),
    additional_charges_cents: Math.round(Number(receipt.additional_charges_cents) || 0),
    payable_total_cents: payableTotal,
    payment_date: String(lastPayment?.created_at || receipt.returned_at || new Date().toISOString()),
    method: String(lastPayment?.method || "—"),
    reference: String(lastPayment?.reference || ""),
    amount_cents: Math.round(
      Number(lastPayment?.converted_amount_cents ?? lastPayment?.amount_cents) || 0,
    ),
    currency,
    total_paid_cents: totalPaid,
    balance_cents: Math.max(payableTotal - totalPaid, 0),
    payment_status: String(receipt.payment_status || "unpaid"),
  };

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateRentalReceiptPdf(receiptData, null);
  } catch {
    return { ok: false, error: "pdf_generation_failed" };
  }

  const guestName = String(receipt.customers?.full_name || "Guest");
  const ref = safeRef(receipt.equipment?.asset_number || receipt.equipment?.name, receipt.rental_id.slice(0, 8));
  const body = `
    <p>Hello <strong>${guestName.replace(/</g, "&lt;")}</strong>,</p>
    <p>Your equipment rental (<strong>${(receipt.equipment?.name || "—").replace(/</g, "&lt;")}</strong>)${
      receipt.equipment?.asset_number ? ` &middot; ${receipt.equipment.asset_number}` : ""
    } has been returned and the return has been processed. Your official rental receipt is attached to this email.</p>
    <p>Thank you for renting with Thoddoo Marine — we hope to welcome you back to Thoddoo soon!</p>`;

  return sendEmail({
    to,
    subject: subjectLine(guestName, "Your equipment rental receipt"),
    html: htmlMessage(body),
    text: `Hello ${guestName},\n\nYour equipment rental (${receipt.equipment?.name || "—"}${receipt.equipment?.asset_number ? ` · ${receipt.equipment.asset_number}` : ""}) has been returned and the return has been processed. Your official rental receipt is attached to this email.\n\nThank you for renting with Thoddoo Marine — we hope to welcome you back to Thoddoo soon!${textSignature()}`,
    attachments: [
      {
        filename: `thoddoo-marine-rental-receipt-${ref}.pdf`,
        contentBase64: pdfBuffer.toString("base64"),
      },
    ],
  });
}