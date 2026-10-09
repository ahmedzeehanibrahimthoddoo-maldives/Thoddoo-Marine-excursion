import { NextRequest, NextResponse } from "next/server";
import { sendConsentCopyEmail } from "@/lib/guest-copies";

const TOKEN_RE = /^[A-Za-z0-9-]{8,200}$/;

/**
 * Guest-facing trigger to email the signed consent & liability waiver PDF.
 * Authorized purely by the unguessable signing token. Deliberately advisory:
 * a failure to send NEVER surfaces as an error to the guest flow.
 */
export async function POST(request: NextRequest) {
  let token = "";
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === "string" ? body.token.trim() : "";
  } catch {
    token = "";
  }

  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 400 });
  }

  const result = await sendConsentCopyEmail(token);
  return NextResponse.json(result, { status: 200 });
}