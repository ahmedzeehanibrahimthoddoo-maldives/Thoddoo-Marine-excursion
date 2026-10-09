import Link from "next/link";
import {
  GENERAL_SAFETY, CONSENT_LIABILITY_ACK, GENERIC_BRIEFING, getBriefing,
} from "@/lib/briefings";
import { fmtDateLong, fmtDateTime } from "@/lib/format";
import { getBooking } from "@/lib/supabase/actions";
import ClientPrintButton from "../../incidents/ClientPrintButton";

export const metadata = { title: "Safety Briefing Card | Thoddoo Marine Admin" };
export const dynamic = "force-dynamic";

export default async function BriefingCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ booking?: string }>;
}) {
  const { slug } = await params;
  const q = await searchParams;

  const briefing = getBriefing(slug) || (slug === "generic" ? GENERIC_BRIEFING : null);
  if (!briefing) {
    return (
      <div className="adminPage">
        <div className="errorState">
          <p>No briefing card exists for “{slug}”.</p>
          <p>
            <Link href="/admin/briefings">← Back to briefing cards</Link>
          </p>
        </div>
      </div>
    );
  }

  let guestLabel = "Guest";
  let bookingRef = "";
  if (q.booking) {
    try {
      const booking = await getBooking(q.booking);
      const customers = booking.customers as { full_name?: string } | null;
      guestLabel = String(customers?.full_name || guestLabel);
      bookingRef = String((booking as { booking_ref?: string }).booking_ref || "");
    } catch {
      /* optional context — leave blank */
    }
  }

  const safetyPool = Array.from(new Set([...briefing.safety, ...GENERAL_SAFETY]));

  return (
    <div className="adminPage irPage">
      <div className="irToolbar no-print" style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <Link href="/admin/briefings" className="formCancel" style={{ padding: "8px 14px", borderRadius: 6, textDecoration: "none" }}>
          ← All cards
        </Link>
        <ClientPrintButton label="Download PDF" />
        <ClientPrintButton label="Print" />
      </div>

      <div className="irDoc bkDoc">
        {/* Letterhead */}
        <div className="irLetterhead">
          <img src="/images/logo.jpeg" alt="Thoddoo Marine Excursion Centre" className="irLogo" />
          <div className="irLetterheadText">
            <h1>Thoddoo Marine Excursion Centre</h1>
            <p>Thoddoo, Alif Alif Atoll, Republic of Maldives</p>
          </div>
          <div className="irDocTitle">
            <span className="irDocTitleTop">SAFETY BRIEFING CARD</span>
            <span className="bkDocRef">{briefing.name}</span>
          </div>
        </div>

        {/* Meta strip */}
        <div className="irMetaStrip bkMeta">
          <div><span className="irLabel">Activity</span><span className="irValue">{briefing.name}</span></div>
          <div><span className="irLabel">Category</span><span className="irValue">{briefing.category}</span></div>
          <div><span className="irLabel">Duration</span><span className="irValue">{briefing.duration}</span></div>
          <div><span className="irLabel">Guest / booking</span><span className="irValue">{guestLabel}{bookingRef ? ` · ${bookingRef}` : ""}</span></div>
        </div>

        {/* Overview */}
        <h2 className="irSectionTitle">1. What to Expect</h2>
        <p className="irParagraph">{briefing.overview}</p>

        {/* What's included / bring */}
        <h2 className="irSectionTitle">2. Provided For You &amp; What to Bring</h2>
        <div className="irFields bkCols">
          <div><span className="irLabel">Provided</span><span className="irValue">{briefing.included.join(" • ")}</span></div>
          <div><span className="irLabel">Bring along</span><span className="irValue">{briefing.bring.join(" • ")}</span></div>
        </div>

        {/* Safety rules (activity specific) */}
        <h2 className="irSectionTitle">3. Activity Safety Rules</h2>
        <ul className="irList">
          {briefing.safety.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>

        {/* General + consent */}
        <h2 className="irSectionTitle">4. General Safety &amp; Consent</h2>
        <p className="irParagraph">Before every Thoddoo Marine activity, our staff personally briefs each guest and reviews the Activity Consent &amp; Liability form together. Please confirm the following:</p>
        <div className="irFields bkCols" style={{ padding: 0, border: "none" }}>
          <div>
            <span className="irLabel">General safety, all activities</span>
            <ul className="irList" style={{ marginTop: 6 }}>
              {GENERAL_SAFETY.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <span className="irLabel">Guest requirements</span>
            <ul className="irList" style={{ marginTop: 6 }}>
              {briefing.requirements.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="irBlock bkAck">
          <span className="irLabel">Consent &amp; liability acknowledgment</span>
          <ul className="irList" style={{ marginTop: 6 }}>
            {CONSENT_LIABILITY_ACK.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>

        {/* Full safety pool reminder */}
        <details className="bkFullSave">
          <summary>Full safety checklist ({safetyPool.length} points) for the guide</summary>
          <ol className="irList">
            {safetyPool.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </details>

        {/* Signatures */}
        <h2 className="irSectionTitle">5. Signatures</h2>
        <p className="irParagraph">
          The staff member above confirms the guest was personally briefed on this card before the activity and that the
          Activity Consent &amp; Liability form for {briefing.name} has been read and signed by the guest.
        </p>
        <div className="irSignatures">
          <div className="irSig">
            <div className="irSigLine">Guest name: ______________________________________</div>
            <div className="irSigSub">Signature &amp; date: ____________________</div>
          </div>
          <div className="irSig">
            <div className="irSigLine">Staff / guide: ______________________________________</div>
            <div className="irSigSub">Signature &amp; date: ____________________</div>
          </div>
        </div>

        <div className="irFooter">
          <p>
            This briefing card is part of the Thoddoo Marine safety program for {briefing.name} at Thoddoo Marine Excursion Centre, Thoddoo.
          </p>
          <p className="no-print">
            Generated {fmtDateTime(new Date().toISOString())} from the Thoddoo Marine PMS.
          </p>
        </div>
      </div>
    </div>
  );
}