import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ConsentPdfData } from "@/lib/consent-pdf";
import { generateConsentPdf } from "@/lib/consent-pdf";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 524288;
const MAX_BASE64_CHARS = 699050;
const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_FETCH_TIMEOUT_MS = 5000;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase().slice(0, 60);
}

/**
 * Fetch the Thoddoo Marine logo as a data URL.
 * Uses HTTP fetch (Cloudflare-compatible) — no filesystem access.
 * Returns null on any failure so PDF still generates without the logo.
 */
async function fetchLogoDataUrl(requestUrl: string): Promise<string | null> {
  try {
    const origin = new URL(requestUrl).origin;
    const logoUrl = `${origin}/images/logo.jpeg`;

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
    if (contentLength && parseInt(contentLength, 10) > MAX_LOGO_BYTES) {
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_LOGO_BYTES) {
      return null;
    }

    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
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

  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid consent ID" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: rpcResult, error: rpcError } = await supabase.rpc("get_consent_for_pdf", {
    p_consent_id: id,
  });

  if (rpcError) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const result = rpcResult as unknown as { error?: string; message?: string } & ConsentPdfData;
  if (result && typeof result === "object" && "error" in result) {
    const msg = (result as { message?: string }).message || "Access denied";
    const status = msg.includes("not found") ? 404 : 403;
    return NextResponse.json({ error: msg }, { status });
  }

  if (!result || typeof result !== "object") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const consent = result as unknown as ConsentPdfData;

  if (!consent.signature_data_url) {
    return NextResponse.json({ error: "Consent record has invalid signature data" }, { status: 500 });
  }

  // Validate signature format
  if (
    !consent.signature_data_url.startsWith("data:image/png;base64,") &&
    !consent.signature_data_url.startsWith("data:image/jpeg;base64,") &&
    !consent.signature_data_url.startsWith("data:image/jpg;base64,")
  ) {
    return NextResponse.json({ error: "Consent record has invalid signature format" }, { status: 500 });
  }

  // Pre-decode base64 length check (max 524,288 decoded bytes ≈ 699,050 base64 chars)
  const base64Payload = consent.signature_data_url.slice(consent.signature_data_url.indexOf(",") + 1);
  if (base64Payload.length > MAX_BASE64_CHARS) {
    return NextResponse.json({ error: "Consent record signature exceeds maximum size" }, { status: 500 });
  }

  // Decode and validate decoded byte length
  try {
    const decoded = atob(base64Payload);
    if (decoded.length > MAX_SIGNATURE_BYTES) {
      return NextResponse.json({ error: "Consent record signature exceeds maximum size" }, { status: 500 });
    }
  } catch {
    return NextResponse.json({ error: "Consent record has malformed signature data" }, { status: 500 });
  }

  // Fetch logo via HTTP — no filesystem access, Cloudflare-compatible
  const logoDataUrl = await fetchLogoDataUrl(request.url);

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateConsentPdf(consent, logoDataUrl);
  } catch {
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }

  if (pdfBuffer.length > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "Generated PDF exceeds size limit" }, { status: 500 });
  }

  const ref = sanitizeFilename(consent.booking_ref || consent.id.slice(0, 8));
  const disposition = request.nextUrl.searchParams.get("download") === "1"
    ? `attachment; filename="thoddoo-marine-consent-${ref}.pdf"`
    : `inline; filename="thoddoo-marine-consent-${ref}.pdf"`;

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
