import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateReceiptPdf, type ReceiptPdfData } from "@/lib/invoice-pdf";
import { type Currency } from "@/lib/money";
import { isFinanceRole } from "@/lib/permissions";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_FETCH_TIMEOUT_MS = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      headers: { Accept: "image/png,image/jpeg,image/*" },
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid payment ID" }, { status: 400 });
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

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select(`
      id, created_at, method, reference, amount_cents, currency,
      status, converted_amount_cents, booking_currency,
      bookings(
        id, booking_ref, booking_date, preferred_time, booking_currency,
        total_cents, estimated_total_cents, adults, children_count, guests, pricing_option_label, partner,
        activities(name, category), customers(full_name, phone, hotel, room_number),
        payments(id, created_at, method, reference, amount_cents, converted_amount_cents, currency, status)
      )
    `)
    .eq("id", id)
    .maybeSingle();

  if (paymentError) {
    return NextResponse.json({ error: "Failed to load payment" }, { status: 500 });
  }
  if (!payment) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  const booking = payment.bookings as unknown as Record<string, unknown> | undefined;
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const bookingCurrency: string = String(booking.booking_currency || "USD");
  const payableTotal = Math.round(
    Number(booking.total_cents) > 0
      ? Number(booking.total_cents)
      : Number(booking.estimated_total_cents) || 0,
  );

  const bookingPayments = Array.isArray(booking.payments) ? booking.payments : [];
  const totalPaid = bookingPayments.reduce<number>((sum, p: Record<string, unknown>) => {
    if (String(p.status) !== "completed") return sum;
    return sum + Math.round(Number(p.converted_amount_cents ?? p.amount_cents ?? 0) || 0);
  }, 0);
  const balance = Math.max(payableTotal - totalPaid, 0);

  const amountCents = Math.round(Number(
    payment.converted_amount_cents ?? payment.amount_cents ?? 0,
  ) || 0);

  const activities = booking.activities as unknown as Record<string, unknown> | undefined;
  const customers = booking.customers as unknown as Record<string, unknown> | undefined;

  const receiptData: ReceiptPdfData = {
    payment_id: String(payment.id),
    booking_ref: String(booking.booking_ref || ""),
    booking_date: String(booking.booking_date || ""),
    preferred_time: String(booking.preferred_time || ""),
    activity_name: String(activities?.name || ""),
    activity_category: String(activities?.category || ""),
    customer_name: String(customers?.full_name || ""),
    phone: String(customers?.phone || ""),
    hotel: String(customers?.hotel || ""),
    room_number: String(customers?.room_number || ""),
    adults: Number(booking.adults) || null,
    children_count: Number(booking.children_count) || null,
    guests: Number(booking.guests) || 0,
    pricing_option_label: String(booking.pricing_option_label || ""),
    payment_date: String(payment.created_at || ""),
    method: String(payment.method || ""),
    reference: String(payment.reference || ""),
    amount_cents: amountCents,
    currency: (bookingCurrency === "MVR" ? "MVR" : "USD") as Currency,
    estimated_total_cents: Math.round(Number(booking.estimated_total_cents) || 0),
    total_cents: Math.round(Number(booking.total_cents) || 0),
    payable_total_cents: payableTotal,
    total_paid_cents: totalPaid,
    balance_cents: balance,
  };

  const logoDataUrl = await fetchLogoDataUrl(request.url);

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateReceiptPdf(receiptData, logoDataUrl, signerName);
  } catch {
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }

  if (pdfBuffer.length > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "Generated PDF exceeds size limit" }, { status: 500 });
  }

  const ref = sanitizeFilename(receiptData.booking_ref || receiptData.payment_id.slice(0, 8));
  const disposition = request.nextUrl.searchParams.get("download") === "1"
    ? `attachment; filename="thoddoo-marine-receipt-${ref}.pdf"`
    : `inline; filename="thoddoo-marine-receipt-${ref}.pdf"`;

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