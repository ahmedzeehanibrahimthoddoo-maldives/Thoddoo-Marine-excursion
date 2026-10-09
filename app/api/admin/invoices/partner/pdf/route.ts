import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  generatePartnerInvoicePdf,
  type PartnerInvoicePdfData,
  type PartnerInvoiceLine,
  type PartnerCurrencyTotals,
} from "@/lib/invoice-pdf";
import { isFinanceRole } from "@/lib/permissions";
import { grossCents, netCents, commissionCents, } from "@/lib/reports";
import type { RangeBooking } from "@/lib/reports";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_FETCH_TIMEOUT_MS = 5000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PARTNER_LEN = 100;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase().slice(0, 60);
}

async function fetchLogoDataUrl(requestUrl: string): Promise<string | null> {
  try {
    const origin = new URL(requestUrl).origin;
    const logoUrl = `${origin}/images/logo-transparent.png`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);
    const res = await fetch(logoUrl, {
      signal: controller.signal,
      headers: { Accept: "image/jpeg,image/png,image/*" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const contentType = res.headers.get("Content-Type") || "";
    if (
      !contentType.includes("image/jpeg") &&
      !contentType.includes("image/png") &&
      !contentType.includes("image/jpg")
    ) {
      return null;
    }
    const contentLength = res.headers.get("Content-Length");
    if (contentLength && parseInt(contentLength, 10) > MAX_LOGO_BYTES) return null;
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_LOGO_BYTES) return null;
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const mime = contentType.includes("image/png") ? "image/png" : "image/jpeg";
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const partner = String(params.get("partner") || "").trim();
  const from = String(params.get("from") || "");
  const to = String(params.get("to") || "");

  if (!partner || partner.length > MAX_PARTNER_LEN) {
    return NextResponse.json({ error: "Partner is required" }, { status: 400 });
  }
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "Valid from/to dates are required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: "From date must be on or before to date" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: roleData } = await supabase.rpc("current_staff_role");
  const role = typeof roleData === "string" ? roleData : null;
  if (!isFinanceRole(role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { data: staffProfile } = await supabase
    .from("staff_profiles")
    .select("full_name")
    .eq("user_id", user.id)
    .maybeSingle();
  const signerName = staffProfile?.full_name ? String(staffProfile.full_name) : undefined;

  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select(`
      id, booking_ref, booking_date, booking_currency, status, payment_status,
      guests, adults, children_count,
      total_cents, estimated_total_cents, net_cents, commission_cents,
      activities(name), customers(full_name)
    `)
    .eq("partner", partner)
    .gte("booking_date", from)
    .lte("booking_date", to);

  if (bookingsError) {
    return NextResponse.json({ error: "Failed to load bookings" }, { status: 500 });
  }

  const rows = (bookings || []) as unknown as RangeBooking[];
  const lines: PartnerInvoiceLine[] = rows.map((b) => ({
    booking_ref: String(b.booking_ref || ""),
    booking_date: String(b.booking_date || ""),
    guest_name: String(b.customers?.full_name || ""),
    activity_name: String(b.activities?.name || ""),
    guests: Math.max(Number(b.guests) || 0, 0),
    booking_currency: b.booking_currency === "MVR" ? "MVR" : "USD",
    gross_cents: grossCents(b),
    commission_cents: commissionCents(b),
    net_cents: netCents(b),
    status: String(b.status || ""),
  })).sort((a, b) => String(a.booking_date).localeCompare(String(b.booking_date)));

  const projectedLines = lines.filter(
    (l) => l.status !== "cancelled" && l.status !== "no_show",
  );

  const totalsByCurrency: PartnerCurrencyTotals[] = (["USD", "MVR"] as const).map((currency) => ({
    currency,
    bookings: projectedLines.filter((l) => l.booking_currency === currency).length,
    pax: projectedLines.filter((l) => l.booking_currency === currency).reduce((s, l) => s + l.guests, 0),
    gross_cents: projectedLines.filter((l) => l.booking_currency === currency).reduce((s, l) => s + l.gross_cents, 0),
    commission_cents: projectedLines.filter((l) => l.booking_currency === currency).reduce((s, l) => s + l.commission_cents, 0),
    net_cents: projectedLines.filter((l) => l.booking_currency === currency).reduce((s, l) => s + l.net_cents, 0),
  })).filter((t) => t.bookings > 0);

  const data: PartnerInvoicePdfData = { partner, from, to, lines: projectedLines, totalsByCurrency };

  const logoDataUrl = await fetchLogoDataUrl(request.url);

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generatePartnerInvoicePdf(data, logoDataUrl, signerName);
  } catch {
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }

  if (pdfBuffer.length > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "Generated PDF exceeds size limit" }, { status: 500 });
  }

  const ref = sanitizeFilename(partner);
  const disposition = request.nextUrl.searchParams.get("download") === "1"
    ? `attachment; filename="thoddoo-marine-partner-statement-${ref}.pdf"`
    : `inline; filename="thoddoo-marine-partner-statement-${ref}.pdf"`;

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}