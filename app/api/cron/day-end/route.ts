import { NextRequest, NextResponse } from "next/server";
import { collectDayEndReport, dayEndRecipient, renderDayEndMail } from "@/lib/dayend-report";
import { isEmailAutoSendConfigured, sendEmail } from "@/lib/mail";

export const dynamic = "force-dynamic";

/**
 * Nightly day-end report, fired by the Vercel cron at 18:00 UTC = 23:00
 * Maldives time. Vercel injects `Authorization: Bearer ${CRON_SECRET}` when
 * CRON_SECRET is set on the project; without it this route answers 401 rather
 * than mailing booking figures to whoever finds the URL.
 *
 *   GET /api/cron/day-end              → today's report, sent
 *   GET /api/cron/day-end?date=2026-10-01
 *   GET /api/cron/day-end?preview=1    → rendered subject + text, NOT sent
 *
 * A send failure returns 502 with the Resend error so Vercel surfaces it, but
 * the report data is never lost: ?preview=1 always renders from the same read.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const collected = await collectDayEndReport(params.get("date"));
  if (!collected.ok) {
    return NextResponse.json(collected, { status: 500 });
  }

  const mail = renderDayEndMail(collected.report);
  const to = dayEndRecipient();

  if (params.get("preview") === "1") {
    return NextResponse.json({
      ok: true,
      preview: true,
      to,
      date: collected.report.date,
      failures: collected.report.failures,
      subject: mail.subject,
      text: mail.text,
    });
  }

  if (!isEmailAutoSendConfigured()) {
    return NextResponse.json({ ok: false, skipped: "not_configured", to, date: collected.report.date });
  }

  const result = await sendEmail({ to, subject: mail.subject, text: mail.text, html: mail.html });
  if (result.skipped) {
    return NextResponse.json({ ...result, to, date: collected.report.date });
  }
  return NextResponse.json(
    {
      ok: result.ok,
      to,
      date: collected.report.date,
      bookings: collected.report.taken.bookings,
      tomorrowBookings: collected.report.tomorrowTrips.bookings,
      failures: collected.report.failures,
      error: result.error,
    },
    { status: result.ok ? 200 : 502 }
  );
}
