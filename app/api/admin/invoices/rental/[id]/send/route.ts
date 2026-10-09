import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isFinanceRole } from "@/lib/permissions";
import { isValidEmail } from "@/lib/email";
import { renderInvoicePdf, sendInvoiceEmail } from "@/lib/invoice-delivery";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid_id", message: "Invalid rental ID" }, { status: 400 });
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

  const { data: rental, error } = await supabase
    .from("equipment_rentals")
    .select(`
      id, rental_charge_cents, additional_charges_cents, currency,
      equipment(name, asset_number),
      customers(full_name, email),
      payments(status, amount_cents, converted_amount_cents, currency, booking_currency)
    `)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, error: "load_failed", message: "Failed to load rental" }, { status: 500 });
  }
  if (!rental) {
    return NextResponse.json({ ok: false, error: "not_found", message: "Rental not found" }, { status: 404 });
  }

  const customers = rental.customers as { full_name?: string | null; email?: string | null } | null;
  const equipment = rental.equipment as { name?: string | null; asset_number?: string | null } | null;
  const to = String(body.email || "").trim() || String(customers?.email || "").trim();
  if (!isValidEmail(to)) {
    return NextResponse.json({
      ok: false,
      error: "missing_recipient",
      message: "No guest email on file. Enter an address to send the receipt to.",
    }, { status: 400 });
  }

  const pdf = await renderInvoicePdf("rental", id, request);
  if ("error" in pdf) {
    return NextResponse.json({ ok: false, error: "pdf_failed", message: pdf.error }, { status: pdf.status });
  }

  // Deposit excluded: it is a refundable hold, never part of what is owed.
  const totalCents =
    (Math.round(Number(rental.rental_charge_cents) || 0) +
      Math.round(Number(rental.additional_charges_cents) || 0));
  const paidCents = ((rental.payments || []) as { status?: string | null; amount_cents?: number | null; converted_amount_cents?: number | null }[])
    .filter((p) => String(p.status) === "completed")
    .reduce((sum, p) => sum + Math.max(Number(p.converted_amount_cents ?? p.amount_cents) || 0, 0), 0);

  const result = await sendInvoiceEmail({
    to,
    kind: "rental",
    ref: String(equipment?.asset_number || equipment?.name || "").toUpperCase(),
    guestName: String(customers?.full_name || ""),
    currency: rental.currency === "MVR" ? "MVR" : "USD",
    totalCents,
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

  return NextResponse.json({ ok: true, email: to });
}
