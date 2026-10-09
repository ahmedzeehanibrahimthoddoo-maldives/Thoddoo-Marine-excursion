import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  generatePartnerInvoicePdf,
  type PartnerCurrencyTotals,
  type PartnerInvoiceLine,
  type PartnerInvoicePdfData,
} from "@/lib/invoice-pdf";
import { isFinanceRole } from "@/lib/permissions";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_FETCH_TIMEOUT_MS = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase().slice(0, 60);
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
      !contentType.includes("image/png") &&
      !contentType.includes("image/jpeg") &&
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

/**
 * Single-booking invoice for the agent / partner.
 *
 * This is the counterpart to /api/admin/invoices/booking/[id]/pdf, which is the
 * guest's copy and must never carry money that is none of their business. This
 * one shows gross, the partner's commission and Thoddoo Marine's net for a single
 * trip, using the same renderer as the period statement on /admin/invoices — the
 * commission column is literally the same code path, so an agent cannot be sent
 * one figure on an invoice and another on the statement.
 *
 * Refuses a booking with no partner rather than printing an invoice addressed to
 * nobody, and a cancelled or no-show trip is printed with its status visible
 * instead of being silently dropped the way the statement drops it from totals.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid booking ID" }, { status: 400 });
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

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(`
      id, booking_ref, booking_date, booking_currency, status, payment_status,
      guests, adults, children_count,
      total_cents, estimated_total_cents, net_cents, commission_cents, partner,
      commission_mode, commission_percent,
      activities(name), customers(full_name)
    `)
    .eq("id", id)
    .maybeSingle();

  if (bookingError) {
    return NextResponse.json({ error: "Failed to load booking" }, { status: 500 });
  }
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const partner = String(booking.partner || "").trim();
  if (!partner) {
    return NextResponse.json(
      { error: "This booking has no partner/agent, so there is nobody to invoice." },
      { status: 400 },
    );
  }

  const activities = (booking.activities || {}) as unknown as Record<string, unknown>;
  const customers = (booking.customers || {}) as unknown as Record<string, unknown>;
  const status = String(booking.status || "");

  // grossCents/netCents/commissionCents keep the same fallbacks as the reports,
  // so the invoice can never disagree with /admin/reports.
  const gross = Math.max(
    Math.round(Number(booking.total_cents) || 0),
    Math.round(Number(booking.estimated_total_cents) || 0),
    0,
  );
  const commission = Math.max(Math.round(Number(booking.commission_cents) || 0), 0);
  const net = Math.max(Math.round(Number(booking.net_cents) || 0), 0);
  const currency = booking.booking_currency === "MVR" ? "MVR" : "USD";
  const guests = Math.max(Number(booking.guests) || 0, 0);

  const lines: PartnerInvoiceLine[] = [{
    booking_ref: String(booking.booking_ref || ""),
    booking_date: String(booking.booking_date || ""),
    guest_name: String(customers.full_name || ""),
    activity_name: String(activities.name || ""),
    guests,
    booking_currency: currency,
    gross_cents: gross,
    commission_cents: commission,
    net_cents: net,
    status,
  }];

  const totalsByCurrency: PartnerCurrencyTotals[] = [{
    currency,
    bookings: 1,
    pax: guests,
    gross_cents: gross,
    commission_cents: commission,
    net_cents: net,
  }];

  // The rate is printed when there is one, so the agent can see how the figure
  // was arrived at rather than just being handed a number.
  const mode = String(booking.commission_mode || "");
  const percent = booking.commission_percent === null || booking.commission_percent === undefined
    ? null
    : Number(booking.commission_percent);
  const rateNote = mode === "percent" && percent !== null && Number.isFinite(percent)
    ? `${percent}% of booking value`
    : null;

  const data: PartnerInvoicePdfData = {
    partner,
    from: String(booking.booking_date || ""),
    to: String(booking.booking_date || ""),
    lines,
    totalsByCurrency,
    title: "AGENT INVOICE",
    periodLabel: `BOOKING ${String(booking.booking_ref || id.slice(0, 8))}`,
  };

  const logoDataUrl = await fetchLogoDataUrl(request.url);

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generatePartnerInvoicePdf(data, logoDataUrl, signerName, rateNote);
  } catch {
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }

  if (pdfBuffer.length > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "Generated PDF exceeds size limit" }, { status: 500 });
  }

  const ref = sanitizeFilename(String(booking.booking_ref || partner) || id.slice(0, 8));
  const disposition = request.nextUrl.searchParams.get("download") === "1"
    ? `attachment; filename="thoddoo-marine-agent-invoice-${ref}.pdf"`
    : `inline; filename="thoddoo-marine-agent-invoice-${ref}.pdf"`;

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