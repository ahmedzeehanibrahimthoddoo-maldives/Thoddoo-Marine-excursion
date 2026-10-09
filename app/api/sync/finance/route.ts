import { NextRequest, NextResponse } from "next/server";
import { syncFinanceSheets } from "@/lib/finance-sync";

export const dynamic = "force-dynamic";

// Called by the Vercel Cron every 30 minutes. Vercel injects the
// `Authorization: Bearer ${CRON_SECRET}` header automatically when the
// CRON_SECRET environment variable is set. A manual sync is done from the
// admin Expenses/Income pages via a role-guarded Server Action instead.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const result = await syncFinanceSheets();
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}