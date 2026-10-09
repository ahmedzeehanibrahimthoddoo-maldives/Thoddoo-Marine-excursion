import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isFinanceRole } from "@/lib/permissions";
import { isValidEmail } from "@/lib/email";
import { renderInvoicePdf, sendInvoiceEmail } from "@/lib/invoice-delivery";
import { paymentAmountInBookingCurrency, isCompletedPayment, type PaymentLike } from "@/lib/reports";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid_id", message: "Invalid booking ID" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized", message: "Unauthorized" }, { status: 401 });
  }
  const { data: roleData } = await supabase.rpc("current_staff_role");
  const role = typeof roleData === "string" ? roleData : null;
  if (!isFinanceRole(role)) {
    return NextResponse.json({ ok: false, error: "forbidden", message: "Access denied" }, { status: 403 });
  }

  let body: { email?: string } = {};
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    body = {};
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select(`
      id, booking_ref, booking_currency, total_cents, estimated_total_cents,
      customers(full_name, email),
      payments(status, amount_cents, converted_amount_cents, currency, booking_currency)
    `)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, error: "load_failed", message: "Failed to load booking" }, { status: 500 });
  }
  if (!booking) {
    return NextResponse.json({ ok: false, error: "not_found", message: "Booking not found" }, { status: 404 });
  }

  const customers = booking.customers as { full_name?: string | null; email?: string | null } | null;
  const to = String(body.email || "").trim() || String(customers?.email || "").trim();
  if (!isValidEmail(to)) {
    return NextResponse.json({
      ok: false,
      error: "missing_recipient",
      message: "No guest email on file. Enter an address to send the invoice to.",
    }, { status: 400 });
  }

  const pdf = await renderInvoicePdf("booking", id, request);
  if ("error" in pdf) {
    return NextResponse.json({ ok: false, error: "pdf_failed", message: pdf.error }, { status: pdf.status });
  }

  const payments = ((booking.payments || []) as unknown as PaymentLike[]).filter(isCompletedPayment);
  const paidCents = payments.reduce((sum, p) => sum + paymentAmountInBookingCurrency(p), 0);
  const total = Math.round(Number(booking.total_cents) || 0);
  const estimated = Math.round(Number(booking.estimated_total_cents) || 0);
  const currency = booking.booking_currency === "MVR" ? "MVR" : "USD";

  const result = await sendInvoiceEmail({
    to,
    kind: "booking",
    ref: String(booking.booking_ref || ""),
    guestName: String(customers?.full_name || ""),
    currency,
    totalCents: total > 0 ? total : estimated,
    paidCents,
    pdf,
  });

  if (!result.ok) {
    const notConfigured = result.skipped === "not_configured";
    return NextResponse.json({
      ok: false,
      error: notConfigured ? "not_configured" : "send_failed",
      message: notConfigured
        ? "Email sending is not configured yet (RESEND_API_KEY missing)."
        : result.error || "The email could not be sent.",
    }, { status: 400 });
  }

  return NextResponse.json({ ok: true, email: to, ref: String(booking.booking_ref || "") });
}
