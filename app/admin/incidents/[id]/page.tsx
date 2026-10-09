import Link from "next/link";
import { getIncidentReport } from "@/lib/supabase/actions";
import { fmtDate, fmtDateLong, fmtDateTime } from "@/lib/format";
import { formatMoneyNullable } from "@/lib/money";
import ClientPrintButton from "../ClientPrintButton";

export const metadata = { title: "Incident Report | Thoddoo Marine Admin" };
export const dynamic = "force-dynamic";

const SEVERITY_LABELS: Record<string, string> = {
  minor: "Minor",
  moderate: "Moderate",
  major: "Major",
  critical: "Critical",
};

const CHARGE_LABELS: Record<string, string> = {
  equipment_damage: "Equipment damage",
  vessel_damage: "Vessel / engine damage",
  jetski_capsize: "Jet-ski capsize / recovery",
  fuel: "Fuel",
  late_return: "Late return",
  accident: "Accident / injury cost",
  card_fee: "Card processing fee",
  other: "Other",
};

export default async function IncidentReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let incident: Record<string, unknown> | null = null;
  let charges: Record<string, unknown>[] = [];
  let error = "";
  try {
    const data = await getIncidentReport(id);
    incident = data.incident as Record<string, unknown>;
    charges = (data.charges || []) as Record<string, unknown>[];
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load incident report.";
  }

  if (error || !incident) {
    return (
      <div className="adminPage">
        <div className="errorState">
          <p>{error || "Incident not found."}</p>
          <p>
            <Link href="/admin/incidents">← Back to incidents</Link>
          </p>
        </div>
      </div>
    );
  }

  const inc = incident;
  const bookings = inc.bookings as Record<string, unknown> | null;
  const customers = inc.customers as Record<string, unknown> | null;
  const activities = inc.activities as Record<string, unknown> | null;
  const photos = (Array.isArray(inc.photos) ? inc.photos : []) as { url?: string; note?: string }[];
  const severity = String(inc.severity || "minor");
  const resolved = Boolean(inc.resolved);
  const quoteCents = (inc.repair_quote_cents as number | null) ?? null;
  const reportRef = "OB/IR/" + String(inc.incident_date ? fmtDate(String(inc.incident_date)).replace(/-/g, "") : "000000") + "-" + String(inc.id).slice(0, 4).toUpperCase();

  return (
    <div className="adminPage irPage">
      <div className="irToolbar no-print" style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <Link href="/admin/incidents" className="formCancel" style={{ padding: "8px 14px", borderRadius: 6, textDecoration: "none" }}>
          ← Back
        </Link>
        <ClientPrintButton label="Download PDF" />
        <ClientPrintButton label="Print" />
      </div>

      <div className="irDoc">
        {/* Letterhead */}
        <div className="irLetterhead">
          <img src="/images/logo.jpeg" alt="Thoddoo Marine Excursion Centre" className="irLogo" />
          <div className="irLetterheadText">
            <h1>Thoddoo Marine Excursion Centre</h1>
            <p>Thoddoo, Alif Alif Atoll, Republic of Maldives</p>
          </div>
          <div className="irDocTitle">
            <span className="irDocTitleTop">OFFICIAL INCIDENT REPORT</span>
            <span className="irDocRef">Report No.: {reportRef}</span>
          </div>
        </div>

        {/* Report meta strip */}
        <div className="irMetaStrip">
          <div><span className="irLabel">Date of incident</span><span className="irValue">{inc.incident_date ? fmtDateLong(String(inc.incident_date)) : "—"}</span></div>
          <div><span className="irLabel">Time of incident</span><span className="irValue">{inc.incident_date ? fmtDateTime(String(inc.incident_date)).split(" ")[1] : "—"}</span></div>
          <div><span className="irLabel">Severity</span><span className="irValue">{SEVERITY_LABELS[severity] || severity}</span></div>
          <div><span className="irLabel">Status</span><span className="irValue">{resolved ? "Resolved" : "Open"}</span></div>
        </div>

        {/* Section 1 */}
        <h2 className="irSectionTitle">1. Involved Parties</h2>
        <div className="irFields">
          <div><span className="irLabel">Guest name</span><span className="irValue">{String(customers?.full_name || "—")}</span></div>
          <div><span className="irLabel">Phone</span><span className="irValue">{String(customers?.phone || "—")}</span></div>
          <div><span className="irLabel">Nationality</span><span className="irValue">{String(customers?.nationality || "—")}</span></div>
          <div><span className="irLabel">Activity</span><span className="irValue">{String(activities?.name || "—")}</span></div>
          <div><span className="irLabel">Equipment / vessel</span><span className="irValue">{[String(inc.equipment_involved || "—"), inc.vessel_ref ? `(${String(inc.vessel_ref)})` : ""].filter(Boolean).join(" ")}</span></div>
          <div><span className="irLabel">Reported by</span><span className="irValue">{String(inc.reported_by || "—")}</span></div>
          <div><span className="irLabel">Booking ref</span><span className="irValue">{String(bookings?.booking_ref || "—")}</span></div>
          <div><span className="irLabel">Booking status</span><span className="irValue">{String(bookings?.status || "—")} / {String(bookings?.payment_status || "—")}</span></div>
          <div><span className="irLabel">Booking total</span><span className="irValue">{formatMoneyNullable(bookings?.total_cents as number | null, (bookings?.booking_currency as string) || "USD")}</span></div>
        </div>

        {/* Section 2 */}
        <h2 className="irSectionTitle">2. Incident Description &amp; Findings</h2>
        <div className="irBlock">
          <span className="irLabel">Description of incident</span>
          <p className="irParagraph">{String(inc.description || "—")}</p>
        </div>
        <div className="irFields">
          <div><span className="irLabel">Warning alarm seen</span><span className="irValue">{inc.alarm_warning_seen ? "Yes" : "No"}</span></div>
          {inc.alarm_notes ? (
            <div className="irWide"><span className="irLabel">Alarm details</span><span className="irValue">{String(inc.alarm_notes)}</span></div>
          ) : null}
          <div className="irWide"><span className="irLabel">Mechanical damage</span><span className="irValue">{String(inc.mechanical_damage || "—")}</span></div>
          <div className="irWide"><span className="irLabel">Evidence / findings</span><span className="irValue">{String(inc.evidence_notes || "—")}</span></div>
          {photos.length > 0 ? (
            <div className="irWide">
              <span className="irLabel">Photographic evidence</span>
              <ul className="irList">
                {photos.map((p, i) => (
                  <li key={i}>
                    {p.note ? `${p.note} — ` : ""}
                    {p.url ? (<Link href={p.url} target="_blank" rel="noreferrer">{p.url}</Link>) : "—"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="irWide"><span className="irLabel">Actions taken</span><span className="irValue">{String(inc.actions_taken || "—")}</span></div>
          <div><span className="irLabel">Witnesses</span><span className="irValue">{String(inc.witness_names || "—")}</span></div>
        </div>

        {/* Section 3 */}
        <h2 className="irSectionTitle">3. Follow-up, Repair &amp; Cost</h2>
        <div className="irFields">
          <div><span className="irLabel">Follow-up required</span><span className="irValue">{inc.follow_up_needed ? "Yes" : "No"}</span></div>
          <div><span className="irLabel">Repair estimate</span><span className="irValue">{quoteCents === null ? "Pending quote" : formatMoneyNullable(quoteCents, (inc.repair_quote_currency as string) || "USD")}</span></div>
          {inc.follow_up_notes ? (
            <div className="irWide"><span className="irLabel">Follow-up notes</span><span className="irValue">{String(inc.follow_up_notes)}</span></div>
          ) : null}
        </div>

        {/* Charges */}
        <h2 className="irSectionTitle">4. Charges Applied to Booking</h2>
        {charges.length > 0 ? (
          <div className="tableWrap">
            <table className="adminTable">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Ref</th>
                  <th>Charged</th>
                </tr>
              </thead>
              <tbody>
                {charges.map((c) => (
                  <tr key={String(c.id)}>
                    <td>{CHARGE_LABELS[String(c.category)] || String(c.category)}</td>
                    <td>{String(c.description || "—")}</td>
                    <td>{formatMoneyNullable(c.amount_cents as number | null, (c.currency as string) || "USD")}</td>
                    <td>{String(c.quotation_reference || "—")}</td>
                    <td>{c.created_at ? fmtDate(String(c.created_at)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="irParagraph">No charges have been applied to this booking.</p>
        )}

        {/* Summary */}
        <h2 className="irSectionTitle">5. Summary</h2>
        <p className="irParagraph">
          {String(activities?.name || "Activity")} incident involving guest{" "}
          {String(customers?.full_name || "—")} (booking {String(bookings?.booking_ref || "—")}), reported on{" "}
          {inc.incident_date ? fmtDateLong(String(inc.incident_date)) : "—"}.{" "}
          {inc.alarm_warning_seen ? "The machine warning was active during the ride. " : ""}
          {inc.mechanical_damage ? "Damage: " + String(inc.mechanical_damage) + ". " : ""}
          {quoteCents === null
            ? "The repair quote is pending; the guest will be charged once the repair cost is confirmed."
            : "Repair estimate: " + formatMoneyNullable(quoteCents, (inc.repair_quote_currency as string) || "USD") + "."}
        </p>

        {/* Signatures */}
        <div className="irSignatures">
          <div className="irSig">
            <div className="irSigLine">Prepared by: _______________________</div>
            <div className="irSigSub">Staff name &amp; signature</div>
            <div className="irSigLine">Date: _______________________</div>
          </div>
          <div className="irSig">
            <div className="irSigLine">Reviewed by (Supervisor): _______________________</div>
            <div className="irSigSub">Operations / management approval</div>
            <div className="irSigLine">Date: _______________________</div>
          </div>
          <div className="irSig">
            <div className="irSigLine">Owner / Management: _______________________</div>
            <div className="irSigSub">Final approval</div>
            <div className="irSigLine">Date: _______________________</div>
          </div>
        </div>

        <div className="irFooter">
          <p>
            This report is a confidential internal document of Thoddoo Marine Excursion Centre, Thoddoo.
          </p>
          <p className="no-print">
            Generated {fmtDateTime(new Date().toISOString())} from the Thoddoo Marine PMS.
          </p>
        </div>
      </div>
    </div>
  );
}