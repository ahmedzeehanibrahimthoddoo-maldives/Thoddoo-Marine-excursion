import type { jsPDF } from "jspdf";
import { formatMoney, type Currency } from "@/lib/money";

export interface InvoicePaymentLine {
  created_at: string | null;
  method: string | null;
  reference: string | null;
  amount_cents: number;
  currency: string | null;
}

export interface GuestInvoicePdfData {
  id: string;
  booking_ref: string | null;
  booking_date: string | null;
  preferred_time: string | null;
  activity_name: string | null;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
  hotel: string | null;
  room_number: string | null;
  adults: number | null;
  children_count: number | null;
  guests: number | null;
  pricing_option_label: string | null;
  booking_currency: string | null;
  estimated_total_cents: number;
  total_cents: number;
  payable_total_cents: number;
  payment_status: string | null;
  payments: InvoicePaymentLine[];
  total_paid_cents: number;
  balance_cents: number;
  partner: string | null;
}

export interface ReceiptPdfData {
  payment_id: string;
  booking_ref: string | null;
  booking_date: string | null;
  preferred_time: string | null;
  activity_name: string | null;
  activity_category: string | null;
  customer_name: string | null;
  phone: string | null;
  hotel: string | null;
  room_number: string | null;
  adults: number | null;
  children_count: number | null;
  guests: number | null;
  pricing_option_label: string | null;
  payment_date: string | null;
  method: string | null;
  reference: string | null;
  amount_cents: number;
  currency: Currency;
  estimated_total_cents: number;
  total_cents: number;
  payable_total_cents: number;
  total_paid_cents: number;
  balance_cents: number;
}

export interface PartnerInvoiceLine {
  booking_ref: string | null;
  booking_date: string | null;
  guest_name: string | null;
  activity_name: string | null;
  guests: number;
  booking_currency: string | null;
  gross_cents: number;
  commission_cents: number;
  net_cents: number;
  status: string | null;
}

export interface PartnerCurrencyTotals {
  currency: Currency;
  bookings: number;
  pax: number;
  gross_cents: number;
  commission_cents: number;
  net_cents: number;
}

export interface PartnerInvoicePdfData {
  partner: string;
  from: string;
  to: string;
  lines: PartnerInvoiceLine[];
  totalsByCurrency: PartnerCurrencyTotals[];
  /**
   * Heading override. The period statement says PARTNER STATEMENT; a single
   * booking is an AGENT INVOICE, and both share this renderer so the commission
   * column can never drift between the two documents.
   */
  title?: string;
  /** Right-hand meta cell, e.g. the booking ref instead of a date range. */
  periodLabel?: string;
}

const NAVY = [0, 64, 128] as const;
const SKY = [54, 183, 255] as const;
const GRAY = [110, 125, 140] as const;

function fmtDay(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function fmtDateTimeShort(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function statusLabel(s: string | null): string {
  switch (s) {
    case "unpaid": return "Unpaid";
    case "partial": return "Partially Paid";
    case "paid": return "Paid in Full";
    case "refunded": return "Refunded";
    default: return String(s || "—");
  }
}

function drawCompanyHeader(doc: jsPDF, pageWidth: number, logoDataUrl?: string | null) {
  const cx = pageWidth / 2;
  const margin = 25;
  if (logoDataUrl) {
    try {
      const fmt = logoDataUrl.includes("image/png") ? "PNG" : "JPEG";
      doc.addImage(logoDataUrl, fmt, cx - 13, 8, 26, 26);
    } catch {
      // Logo invalid — continue with text-only header
    }
  }
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...NAVY);
  doc.text("Thoddoo, Maldives", cx, 40, { align: "center" });
  doc.setDrawColor(...SKY);
  doc.setLineWidth(0.6);
  doc.line(margin, 45, pageWidth - margin, 45);
}

function drawTitle(doc: jsPDF, pageWidth: number, title: string, y: number): number {
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text(title, pageWidth / 2, y, { align: "center" });
  return y + 4;
}

function drawMetaRow(doc: jsPDF, margin: number, pageWidth: number, y: number, left: [string, string], right: [string, string]): number {
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text(left[0] + ":", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(left[1], margin + 32, y);
  doc.setFont("helvetica", "bold");
  doc.text(right[0] + ":", pageWidth - margin - 52, y);
  doc.setFont("helvetica", "normal");
  doc.text(right[1], pageWidth - margin - 52 + 32, y);
  return y + 7;
}

function drawSection(doc: jsPDF, margin: number, pageWidth: number, y: number, title: string): number {
  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text(title, margin, y);
  doc.setDrawColor(...SKY);
  doc.setLineWidth(0.3);
  doc.line(margin, y + 2, pageWidth - margin, y + 2);
  return y + 8;
}

function meaningfulOption(label: string | null | undefined, activity: string | null | undefined): string | null {
  const l = String(label || "").trim();
  const a = String(activity || "").trim();
  if (!l) return null;
  if (a && l.toLowerCase() === a.toLowerCase()) return null;
  return l;
}

function snorkelingIncludes(category: string | null | undefined): string[] {
  if (String(category || "").toLowerCase() !== "snorkeling") return [];
  return ["Snorkeling Gear", "GoPro Video"];
}

export function buildReceiptIncludes(
  pricingOption: string | null | undefined,
  activityCategory: string | null | undefined,
): string[] {
  const includes: string[] = ["Water"];
  if (pricingOption && pricingOption.trim()) includes.unshift(pricingOption);
  includes.push(...snorkelingIncludes(activityCategory));
  return includes;
}

function drawBullet(doc: jsPDF, margin: number, y: number, label: string, value: string | null): number {
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...NAVY);
  doc.text("•", margin + 1, y);
  doc.setFont("helvetica", "bold");
  doc.text(label, margin + 7, y);
  const labelW = doc.getTextWidth(label);
  const vx = margin + 7 + labelW + (value ? 2.5 : 0);
  doc.setFont("helvetica", "normal");
  const maxW = doc.internal.pageSize.getWidth() - margin - vx - 5;
  const valueLines = doc.splitTextToSize((value || "—") as string, Math.max(15, maxW));
  doc.text(Array.isArray(valueLines) ? valueLines[0] : valueLines, vx, y);
  return y + 6.5;
}

function drawBulletList(doc: jsPDF, margin: number, y: number, items: string[]): number {
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...NAVY);
  for (const item of items) {
    doc.text("•  " + (item || "—"), margin + 4, y);
    y += 6.5;
  }
  return y;
}

function drawKeyValue(doc: jsPDF, margin: number, pageWidth: number, y: number, key: string, value: string, valueX?: number): number {
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text(key + ":", margin, y);
  const vx = valueX ?? margin + 32;
  doc.setFont("helvetica", "normal");
  const maxW = pageWidth - margin - vx;
  const lines = doc.splitTextToSize(value || "—", Math.max(20, maxW));
  doc.text(Array.isArray(lines) ? lines[0] : lines, vx, y);
  return y + 6.5;
}

function addFooter(doc: jsPDF, signerName?: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const cx = pageWidth / 2;
  doc.setFontSize(12);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(...GRAY);
  doc.text("Thank you", cx, pageHeight - 70, { align: "center" });
  doc.setFontSize(9);
  doc.text("for Business with us", cx, pageHeight - 63, { align: "center" });

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text("Thoddoo Marine Excursion Centre", 25, pageHeight - 44);
  doc.text("Proprietor: Hassan Saeed", 25, pageHeight - 38);
  doc.text("TIN (MIRA Registered): 1126995GST501", 25, pageHeight - 32);
  doc.text("BML USD Account No: 7730000649500", 25, pageHeight - 26);
  doc.text("BML MVR Account No: 7730000649501", 25, pageHeight - 20);

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text(signerName || "Thoddoo Marine Team", 25, pageHeight - 14);
}

export async function generateReceiptPdf(
  data: ReceiptPdfData,
  logoDataUrl?: string | null,
  signerName?: string,
): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 25;
  const contentWidth = pageWidth - margin * 2;

  function money(cents: number): string {
    return formatMoney(Math.max(Number(cents) || 0, 0), data.currency);
  }

  const guestsLine = data.adults != null || data.children_count != null
    ? `${Number(data.guests) || 0} PAX (${Number(data.adults) || 0} adult${Number(data.adults) === 1 ? "" : "s"}, ${Number(data.children_count) || 0} child${Number(data.children_count) === 1 ? "" : "ren"})`
    : `${Number(data.guests) || 0} PAX`;

  drawCompanyHeader(doc, pageWidth, logoDataUrl);

  let y = 50;
  y = drawTitle(doc, pageWidth, "CONFIRMATION RECEIPT", y);

  y = drawMetaRow(doc, margin, pageWidth, y + 2, ["DATE", fmtDay(data.booking_date)], ["RECEIPT NO", data.booking_ref || data.payment_id.slice(0, 8).toUpperCase()]);

  y += 4;
  y = drawSection(doc, margin, pageWidth, y, "ACTIVITY");
  y = drawBullet(doc, margin, y, "Activity", data.activity_name);
  const receiptOption = meaningfulOption(data.pricing_option_label, data.activity_name);
  if (receiptOption) y = drawBullet(doc, margin, y, "Option", receiptOption);
  if (data.preferred_time) y = drawBullet(doc, margin, y, "Time", data.preferred_time);
  y += 3;

  y = drawSection(doc, margin, pageWidth, y, "DEPARTURE INFORMATION");
  y = drawBullet(doc, margin, y, "Meeting Point", "Thoddoo Marine Excursion Centre");
  if (data.preferred_time) y = drawBullet(doc, margin, y, "Departure Time", data.preferred_time);
  y += 3;

  const includes = buildReceiptIncludes(receiptOption, data.activity_category);
  y = drawSection(doc, margin, pageWidth, y, "INCLUDES");
  y = drawBulletList(doc, margin, y, includes);
  y += 3;

  doc.setDrawColor(...SKY);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text("GUESTS", margin, y);
  doc.text("AMOUNT", pageWidth - margin - 30, y, { align: "right" });
  y += 6;
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(guestsLine, margin, y);
  doc.text(money(data.amount_cents), pageWidth - margin - 30, y, { align: "right" });
  y += 12;

  doc.setDrawColor(...SKY);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text(`Payment method: ${(data.method || "—").replace(/_/g, " ")}`, margin, y);
  y += 5;
  doc.text(`Paid: ${money(data.amount_cents)} of total ${money(data.payable_total_cents)}`, margin, y);
  y += 5;
  doc.text(`Balance remaining: ${money(data.balance_cents)}`, margin, y);

  addFooter(doc, signerName);
  const pdfArray = doc.output("arraybuffer");
  return Buffer.from(pdfArray);
}

// =============================================
// RENTAL RECEIPT PDF
// =============================================

export interface RentalReceiptPdfData {
  rental_id: string;
  customer_name: string | null;
  phone: string | null;
  hotel: string | null;
  room_number: string | null;
  equipment_name: string | null;
  asset_number: string | null;
  checked_out_at: string | null;
  expected_return_at: string | null;
  returned_at: string | null;
  rental_charge_cents: number;
  deposit_cents: number;
  additional_charges_cents: number;
  payable_total_cents: number;
  payment_date: string | null;
  method: string | null;
  reference: string | null;
  amount_cents: number;
  currency: Currency;
  total_paid_cents: number;
  balance_cents: number;
  payment_status: string | null;
}

export async function generateRentalReceiptPdf(
  data: RentalReceiptPdfData,
  logoDataUrl?: string | null,
  signerName?: string,
): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 25;
  const currency: Currency = data.currency;

  function money(cents: number): string {
    return formatMoney(Math.max(Number(cents) || 0, 0), currency);
  }

  drawCompanyHeader(doc, pageWidth, logoDataUrl);

  let y = 50;
  y = drawTitle(doc, pageWidth, "RENTAL RECEIPT", y);

  const checkoutDate = fmtDateTimeShort(data.checked_out_at);
  y = drawMetaRow(
    doc,
    margin,
    pageWidth,
    y + 2,
    ["DATE", fmtDay(data.payment_date)],
    ["RECEIPT NO", (data.rental_id || "").slice(0, 8).toUpperCase()],
  );

  y += 2;
  y = drawSection(doc, margin, pageWidth, y, "RENTED TO");
  y = drawKeyValue(doc, margin, pageWidth, y, "Guest", data.customer_name || "—");
  if (data.phone) y = drawKeyValue(doc, margin, pageWidth, y, "Phone", data.phone);
  if (data.hotel) y = drawKeyValue(doc, margin, pageWidth, y, "Hotel", data.hotel);
  if (data.room_number) y = drawKeyValue(doc, margin, pageWidth, y, "Room", data.room_number);
  y += 3;

  y = drawSection(doc, margin, pageWidth, y, "EQUIPMENT");
  y = drawBullet(doc, margin, y, "Item", data.equipment_name);
  if (data.asset_number) y = drawBullet(doc, margin, y, "Asset No", data.asset_number);
  if (data.checked_out_at) y = drawBullet(doc, margin, y, "Checked Out", checkoutDate);
  if (data.expected_return_at) y = drawBullet(doc, margin, y, "Expected Return", fmtDay(data.expected_return_at));
  y += 3;

  y = drawSection(doc, margin, pageWidth, y, "CHARGES");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GRAY);
  doc.text("Item", margin, y);
  doc.text("Amount", pageWidth - margin - 30, y, { align: "right" });
  y += 5;
  doc.setDrawColor(...SKY);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text(`Rental charge`, margin, y);
  doc.text(money(data.rental_charge_cents), pageWidth - margin - 30, y, { align: "right" });
  y += 6;

  if (data.additional_charges_cents > 0) {
    doc.text(`Additional charges`, margin, y);
    doc.text(money(data.additional_charges_cents), pageWidth - margin - 30, y, { align: "right" });
    y += 6;
  }

  doc.setDrawColor(...SKY);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text("TOTAL", margin, y);
  doc.text(money(data.payable_total_cents), pageWidth - margin - 30, y, { align: "right" });

  // The deposit is a refundable hold, not money owed, so it is shown after the
  // total instead of inside it — matching create_rental_payment, which only
  // accepts payments against rental charge + additional charges.
  if (data.deposit_cents > 0) {
    y += 6;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text(`Deposit held (refundable, not part of total)`, margin, y);
    doc.text(money(data.deposit_cents), pageWidth - margin - 30, y, { align: "right" });
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
  }
  y += 12;

  doc.setDrawColor(...SKY);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text(`Payment method: ${(data.method || "—").replace(/_/g, " ")}`, margin, y);
  y += 5;
  doc.text(`Paid: ${money(data.amount_cents)}`, margin, y);
  y += 5;
  const ref = data.reference ? `Reference: ${data.reference}` : `Payment status: ${(data.payment_status || "unpaid").replace(/_/g, " ")}`;
  doc.text(ref, margin, y);
  y += 5;
  doc.text(`Balance remaining: ${money(data.balance_cents)}`, margin, y);

  addFooter(doc, signerName);
  const pdfArray = doc.output("arraybuffer");
  return Buffer.from(pdfArray);
}

export async function generateGuestInvoicePdf(
  data: GuestInvoicePdfData,
  logoDataUrl?: string | null,
  signerName?: string,
): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 25;
  const contentWidth = pageWidth - margin * 2;
  const currency: Currency = data.booking_currency === "MVR" ? "MVR" : "USD";

  function money(cents: number): string {
    return formatMoney(Math.max(Number(cents) || 0, 0), currency);
  }

  const guestsLine = data.adults != null || data.children_count != null
    ? `${Number(data.guests) || 0} PAX (${Number(data.adults) || 0} adult${Number(data.adults) === 1 ? "" : "s"}, ${Number(data.children_count) || 0} child${Number(data.children_count) === 1 ? "" : "ren"})`
    : `${Number(data.guests) || 0} PAX`;

  drawCompanyHeader(doc, pageWidth, logoDataUrl);

  let y = 50;
  y = drawTitle(doc, pageWidth, "INVOICE", y);

  y = drawMetaRow(doc, margin, pageWidth, y + 2, ["INVOICE DATE", fmtDay(new Date().toISOString())], ["INVOICE NO", data.booking_ref || data.id.slice(0, 8).toUpperCase()]);

  y += 2;
  y = drawSection(doc, margin, pageWidth, y, "BILLED TO");
  y = drawKeyValue(doc, margin, pageWidth, y, "Guest", data.customer_name || "—");
  if (data.email) y = drawKeyValue(doc, margin, pageWidth, y, "Email", data.email);
  if (data.phone) y = drawKeyValue(doc, margin, pageWidth, y, "Phone", data.phone);
  if (data.hotel) y = drawKeyValue(doc, margin, pageWidth, y, "Hotel", data.hotel);
  if (data.room_number) y = drawKeyValue(doc, margin, pageWidth, y, "Room", data.room_number);
  if (data.partner) y = drawKeyValue(doc, margin, pageWidth, y, "Agent", data.partner);
  y += 3;

  y = drawSection(doc, margin, pageWidth, y, "ACTIVITY");
  y = drawBullet(doc, margin, y, "Activity", data.activity_name);
  y = drawBullet(doc, margin, y, "Date", fmtDay(data.booking_date));
  if (data.preferred_time) y = drawBullet(doc, margin, y, "Time", data.preferred_time);
  const invoiceOption = meaningfulOption(data.pricing_option_label, data.activity_name);
  if (invoiceOption) y = drawBullet(doc, margin, y, "Option", invoiceOption);
  y = drawBullet(doc, margin, y, "Guests", guestsLine);
  y += 3;

  y = drawSection(doc, margin, pageWidth, y, "CHARGES");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GRAY);
  doc.text("Item", margin, y);
  doc.text("Amount", pageWidth - margin - 30, y, { align: "right" });
  y += 5;
  doc.setDrawColor(...SKY);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...NAVY);
  doc.text(String(data.activity_name || "Activity"), margin, y);
  doc.text(money(data.payable_total_cents), pageWidth - margin - 30, y, { align: "right" });
  y += 6;
  if (invoiceOption) {
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...GRAY);
    doc.text(invoiceOption, margin, y);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...NAVY);
    y += 6;
  }

  doc.setDrawColor(...SKY);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  y = drawSection(doc, margin, pageWidth, y, "PAYMENTS");
  if (data.payments && data.payments.length > 0) {
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GRAY);
    doc.text("Date", margin, y);
    doc.text("Method", margin + 40, y);
    doc.text("Reference", margin + 75, y);
    doc.text("Amount", pageWidth - margin - 30, y, { align: "right" });
    y += 5;
    doc.setDrawColor(...SKY);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...NAVY);
    for (const p of data.payments) {
      doc.text(fmtDay(p.created_at), margin, y);
      doc.text((p.method || "—").replace(/_/g, " "), margin + 40, y);
      doc.text(p.reference || "—", margin + 75, y);
      doc.text(money(p.amount_cents || 0), pageWidth - margin - 30, y, { align: "right" });
      y += 6;
    }
  } else {
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...GRAY);
    doc.text("No payments recorded yet.", margin, y);
    y += 6;
  }
  y += 4;

  doc.setDrawColor(...SKY);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...NAVY);
  doc.text("Total", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(money(data.payable_total_cents), pageWidth - margin - 30, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.text("Total Paid", margin, y);
  doc.text(money(data.total_paid_cents), pageWidth - margin - 30, y, { align: "right" });
  y += 7;
  doc.setDrawColor(...SKY);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 7;
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text("Balance Due", margin, y);
  doc.text(money(data.balance_cents), pageWidth - margin - 30, y, { align: "right" });

  addFooter(doc, signerName);
  const pdfArray = doc.output("arraybuffer");
  return Buffer.from(pdfArray);
}

export async function generatePartnerInvoicePdf(
  data: PartnerInvoicePdfData,
  logoDataUrl?: string | null,
  signerName?: string,
  /** Optional "how the commission was arrived at" note, e.g. "10% of booking value". */
  rateNote?: string | null,
): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 25;
  const contentWidth = pageWidth - margin * 2;

  drawCompanyHeader(doc, pageWidth, logoDataUrl);

  let y = 50;
  y = drawTitle(doc, pageWidth, data.title || "PARTNER STATEMENT", y);

  y = drawMetaRow(
    doc, margin, pageWidth, y + 2,
    ["PARTNER", data.partner],
    ["PERIOD", data.periodLabel || `${fmtDay(data.from)} — ${fmtDay(data.to)}`]
  );
  y += 4;

  y = drawSection(doc, margin, pageWidth, y, "BOOKINGS");

  const cols = [
    { label: "Date", w: 22 },
    { label: "Ref", w: 28 },
    { label: "Guest", w: 40 },
    { label: "Activity", w: 38 },
    { label: "Gross", w: 16 },
    { label: "Comm.", w: 16 },
    { label: "Net", w: 16 },
  ];
  const rowH = 6;

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GRAY);
  let x = margin;
  for (const col of cols) {
    doc.text(col.label, x + (col.label === "Gross" || col.label === "Comm." || col.label === "Net" ? col.w - 2 : 0), y, { align: col.label === "Gross" || col.label === "Comm." || col.label === "Net" ? "right" : "left" });
    x += col.w;
  }
  y += 4;
  doc.setDrawColor(...SKY);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  if (data.lines.length === 0) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...GRAY);
    doc.text("No bookings found for this partner in the selected period.", margin, y);
    y += 8;
  } else {
    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i];
      const currency: Currency = line.booking_currency === "MVR" ? "MVR" : "USD";
      x = margin;
      const vals = [
        fmtDay(line.booking_date),
        String(line.booking_ref || "—"),
        String(line.guest_name || "—"),
        String(line.activity_name || "—"),
        formatMoney(Math.max(Number(line.gross_cents) || 0, 0), currency),
        formatMoney(Math.max(Number(line.commission_cents) || 0, 0), currency),
        formatMoney(Math.max(Number(line.net_cents) || 0, 0), currency),
      ];
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...NAVY);
      for (let j = 0; j < vals.length; j++) {
        const col = cols[j];
        const isRight = j >= 4;
        const lines2 = doc.splitTextToSize(vals[j], Math.max(8, col.w - 4));
        doc.text(lines2[0], x + (isRight ? col.w - 2 : 0), y, { align: isRight ? "right" : "left" });
        x += col.w;
      }
      y += rowH;
      if (i < data.lines.length - 1) {
        doc.setDrawColor(230, 235, 240);
        doc.setLineWidth(0.2);
        doc.line(margin, y, pageWidth - margin, y);
        y += 1;
      }
    }
  }

  y += 6;
  y = drawSection(doc, margin, pageWidth, y, "TOTALS BY CURRENCY");
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GRAY);
  const tCols = ["Currency", "Bookings", "Pax", "Gross", "Commission", "Net"];
  let tx = margin;
  for (let i = 0; i < tCols.length; i++) {
    const isRight = i >= 3;
    doc.text(tCols[i], tx + (isRight ? (i === 3 ? 20 : i === 4 ? 30 : 22) - 2 : 0), y, { align: isRight ? "right" : "left" });
    tx += i === 3 ? 20 : i === 4 ? 30 : i === 5 ? 22 : i === 0 ? 24 : i === 1 ? 22 : 18;
  }
  y += 4;
  doc.setDrawColor(...SKY);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  if (data.totalsByCurrency.length === 0) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...GRAY);
    doc.text("—", margin, y);
    y += 6;
  } else {
    for (const t of data.totalsByCurrency) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...NAVY);
      let ttx = margin;
      const tvals = [
        t.currency,
        String(t.bookings),
        String(t.pax),
        formatMoney(t.gross_cents, t.currency),
        formatMoney(t.commission_cents, t.currency),
        formatMoney(t.net_cents, t.currency),
      ];
      for (let i = 0; i < tvals.length; i++) {
        const isRight = i >= 3;
        const w = i === 3 ? 20 : i === 4 ? 30 : i === 5 ? 22 : i === 0 ? 24 : i === 1 ? 22 : 18;
        doc.text(tvals[i], ttx + (isRight ? w - 2 : 0), y, { align: isRight ? "right" : "left" });
        ttx += w;
      }
      y += 6;
    }
  }

  if (rateNote) {
    y += 2;
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...NAVY);
    doc.text(`Commission basis: ${rateNote}`, margin, y);
    y += 5;
  }

  y += 4;
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(...GRAY);
  doc.text(
    "Gross = guest total · Commission = amount due to the partner · Net = Thoddoo Marine take. Amounts shown in the booking currency.",
    margin,
    y,
  );

  addFooter(doc, signerName);
  const pdfArray = doc.output("arraybuffer");
  return Buffer.from(pdfArray);
}