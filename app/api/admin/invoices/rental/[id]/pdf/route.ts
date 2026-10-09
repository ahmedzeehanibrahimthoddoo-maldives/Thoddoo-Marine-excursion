import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateRentalReceiptPdf, type RentalReceiptPdfData } from "@/lib/invoice-pdf";
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
    return NextResponse.json({ error: "Invalid rental ID" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: roleData } = await supabase.rpc("current_staff_role");
  const role = typeof roleData === "string" ? roleData : null;
  if (!isFinanceRole(role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { data: rental, error: rentalError } = await supabase
    .from("equipment_rentals")
    .select(
      `
        id, checked_out_at, expected_return_at, returned_at,
        rental_charge_cents, deposit_cents, additional_charges_cents,
        currency, payment_status,
        equipment(name, asset_number),
        customers(full_name, phone, hotel, room_number),
        payments(
          id, created_at, method, reference, amount_cents, converted_amount_cents,
          currency, status
        )
      `,
    )
    .eq("id", id)
    .maybeSingle();

  if (rentalError) {
    return NextResponse.json({ error: "Failed to load rental" }, { status: 500 });
  }
  if (!rental) {
    return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  }

  const equipment = rental.equipment as unknown as Record<string, unknown> | undefined;
  const customers = rental.customers as unknown as Record<string, unknown> | undefined;

  const allPayments = Array.isArray(rental.payments) ? rental.payments : [];
  const completedPayments = allPayments.filter(
    (p: Record<string, unknown>) => String(p.status) === "completed",
  );
  const totalPaid = completedPayments.reduce<number>(
    (sum, p: Record<string, unknown>) =>
      sum + Math.round(Number(p.converted_amount_cents ?? p.amount_cents ?? 0) || 0),
    0,
  );

  // Newest first: PostgREST gives no guaranteed order for embedded rows, and
  // the receipt quotes whichever payment it picks as "Paid".
  const sorted = [...completedPayments].sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || "")),
  );
  const lastPayment = sorted[0] as Record<string, unknown> | undefined;

  // Matches create_rental_payment: the deposit is refundable, so it is never
  // part of what the guest owes.
  const payableTotal = Math.round(
    (Number(rental.rental_charge_cents) || 0) +
    (Number(rental.additional_charges_cents) || 0),
  );
  const balance = Math.max(payableTotal - totalPaid, 0);

  const rentalCurrency: Currency = rental.currency === "MVR" ? "MVR" : "USD";
  const paymentDate = lastPayment?.created_at ? String(lastPayment.created_at) : new Date().toISOString();
  const amountCents = Math.round(
    Number(lastPayment?.converted_amount_cents ?? lastPayment?.amount_cents ?? 0) || 0,
  );

  const receiptData: RentalReceiptPdfData = {
    rental_id: String(rental.id),
    customer_name: String(customers?.full_name || "—"),
    phone: String(customers?.phone || ""),
    hotel: String(customers?.hotel || ""),
    room_number: String(customers?.room_number || ""),
    equipment_name: String(equipment?.name || "—"),
    asset_number: String(equipment?.asset_number || ""),
    checked_out_at: String(rental.checked_out_at || ""),
    expected_return_at: String(rental.expected_return_at || ""),
    returned_at: String(rental.returned_at || ""),
    rental_charge_cents: Math.round(Number(rental.rental_charge_cents) || 0),
    deposit_cents: Math.round(Number(rental.deposit_cents) || 0),
    additional_charges_cents: Math.round(Number(rental.additional_charges_cents) || 0),
    payable_total_cents: payableTotal,
    payment_date: paymentDate,
    method: String(lastPayment?.method || "—"),
    reference: String(lastPayment?.reference || ""),
    amount_cents: amountCents,
    currency: rentalCurrency,
    total_paid_cents: totalPaid,
    balance_cents: balance,
    payment_status: String(rental.payment_status || "unpaid"),
  };

  const logoDataUrl = await fetchLogoDataUrl(request.url);

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateRentalReceiptPdf(receiptData, logoDataUrl, role === "owner" ? "Thoddoo Marine" : undefined);
  } catch {
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }

  if (pdfBuffer.length > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "Generated PDF exceeds size limit" }, { status: 500 });
  }

  const ref = sanitizeFilename(receiptData.asset_number || receiptData.equipment_name || receiptData.rental_id.slice(0, 8));
  const disposition =
    request.nextUrl.searchParams.get("download") === "1"
      ? `attachment; filename="thoddoo-marine-rental-receipt-${ref}.pdf"`
      : `inline; filename="thoddoo-marine-rental-receipt-${ref}.pdf"`;

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