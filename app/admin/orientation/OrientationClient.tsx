"use client";

import { useState } from "react";

interface Props {
  sampleBooking: Record<string, unknown> | null;
  sampleTrip: Record<string, unknown> | null;
}

interface Step {
  letter: string;
  title: string;
  page: string;
  href: string;
  what: string;
  why: string;
  tip?: string;
}

const STEPS: Step[] = [
  {
    letter: "A",
    title: "Receive Booking",
    page: "Bookings",
    href: "/admin/bookings",
    what: "Guest books an activity — either via the public website booking form, walk-in, or you enter it manually from the Bookings page.",
    why: "Every guest interaction starts here. A booking is the source of truth for what the guest wants.",
    tip: "Always confirm the activity, preferred date, number of guests, and any special requests before proceeding.",
  },
  {
    letter: "B",
    title: "Create / Find Customer",
    page: "Customers",
    href: "/admin/customers",
    what: "Create a new customer record (or find an existing one) and fill in: full name, phone, email, hotel, room number, nationality, emergency contact name & phone.",
    why: "Complete customer info is needed for consent forms, manifests, and safety in case of emergency.",
    tip: "Ask the guest for their hotel name and room number — this is used for transfers and follow-up.",
  },
  {
    letter: "C",
    title: "Collect Payment",
    page: "Payments",
    href: "/admin/payments",
    what: "Collect deposit or full payment for the booking. The booking payment_status updates automatically when payments are recorded.",
    why: "Payment must be collected before the trip departs. The booking must show as paid or partially paid.",
    tip: "Check the Bookings page — bookings with an unpaid balance show a payment warning. Collect the remaining balance before the trip date.",
  },
  {
    letter: "D",
    title: "Create Trip",
    page: "Trips",
    href: "/admin/trips",
    what: "Open the Trips page and create a new trip: choose the activity product, select a boat from the fleet, set the date, start time, and capacity.",
    why: "A trip is the actual scheduled departure — it groups multiple bookings onto one boat for one date/time.",
    tip: "For Private Boat Hire: enter the destination island, set the price, and choose USD or MVR.",
  },
  {
    letter: "E",
    title: "Assign Booking → Trip",
    page: "Ops Board",
    href: "/admin/operations",
    what: "Open the Ops Board, find the trip, and assign the booking to it. The guest appears on the trip manifest.",
    why: "This links the guest's booking to a specific boat departure — the guest now has a seat on that trip.",
    tip: "Use the ⚡ quick-assign button on the Ops Board, or drag the booking onto the trip card.",
  },
  {
    letter: "F",
    title: "Assign Crew",
    page: "Ops Board",
    href: "/admin/operations",
    what: "Assign a guide (watersports instructor) and a captain (boat driver) to the trip.",
    why: "Every trip needs a captain. A guide is needed for most activities. They must know the schedule in advance.",
    tip: "Use the WhatsApp button next to crew names on the trip card to notify them of the assignment.",
  },
  {
    letter: "G",
    title: "Send Consent Form",
    page: "My Tasks",
    href: "/admin/tasks",
    what: "A safety consent form is created and a unique link is sent to the guest via WhatsApp. The guest clicks the link to read and sign the consent.",
    why: "Consent is required before the guest participates. Without a signed consent, the guest cannot go on the trip.",
    tip: "Go to My Tasks → Consents Pending → click 'Send link'. The link is valid for 48 hours.",
  },
  {
    letter: "H",
    title: "Guest Signs Consent",
    page: "Consents",
    href: "/admin/consents",
    what: "The guest receives the WhatsApp message, opens the link, reads the safety information, and signs the form. Status changes to 'signed'.",
    why: "Once signed, the guest is cleared for the activity. You can check the status from the Consents page.",
    tip: "If the link expires (after 48 hours), go to Consents → regenerate a new link and resend.",
  },
  {
    letter: "I",
    title: "Finalize Manifest",
    page: "Manifests",
    href: "/admin/manifests",
    what: "Open the trip manifest and fill in: arrival date, arrival time, transfer details, hotel, room number, and any special requests.",
    why: "This gives the crew all the logistics they need — who is arriving, when, how, and where they are staying.",
    tip: "Check the manifest on the morning of the trip to make sure all guest details are complete.",
  },
  {
    letter: "J",
    title: "Check-In Guest",
    page: "Manifests",
    href: "/admin/manifests",
    what: "When the guest arrives (or confirms ready), check them in on the manifest — click the check-in button next to their name.",
    why: "Check-in confirms the guest is physically present and ready to go. Unchecked guests may be no-shows.",
    tip: "Compare the checked-in count against the trip capacity. If someone is missing 30 minutes before departure, call them.",
  },
  {
    letter: "K",
    title: "Mark Trip Ready",
    page: "Ops Board",
    href: "/admin/operations",
    what: "When the boat is prepared, crew is briefed, and guests are checked in, mark the trip as 'Ready' (departing soon).",
    why: "This signals to everyone — crew, reception, management — that the trip is about to leave.",
    tip: "On the Ops Board, click the ✓ button next to the trip. The trip card changes color.",
  },
  {
    letter: "L",
    title: "Trip Departed",
    page: "Ops Board",
    href: "/admin/operations",
    what: "Once the boat leaves the jetty, mark the trip as 'Departed'. The trip is now live — guests are on the water.",
    why: "This stops any further changes and tells reception the guests are away. No more check-ins are possible.",
    tip: "Click the ⛵ button on the Ops Board. The manifest is now locked.",
  },
  {
    letter: "M",
    title: "Trip Complete",
    page: "Ops Board",
    href: "/admin/operations",
    what: "When the boat returns and guests disembark, mark the trip as 'Returned'. The trip is now finished.",
    why: "This closes out the trip in the system and makes the boat available for the next departure.",
    tip: "On the Ops Board, click the → button to mark returned. The trip moves to the completed list.",
  },
  {
    letter: "N",
    title: "Confirm & Close",
    page: "Bookings",
    href: "/admin/bookings",
    what: "Verify all payments for the booking are reconciled (no outstanding balance). Check that the consent form is signed and stored. The booking is now fully complete.",
    why: "Every booking should end with a clean payment record and signed consent on file.",
    tip: "Open Bookings → find the booking → confirm payment_status is 'paid' and consent_forms status is 'signed'.",
  },
];

export default function OrientationClient({ sampleBooking, sampleTrip }: Props) {
  const [expanded, setExpanded] = useState<string | null>("A");

  const bName = (sampleBooking?.customers as Record<string, unknown> | undefined)?.full_name as string | undefined;
  const bRef = sampleBooking?.booking_ref as string | undefined;
  const bActivity = (sampleBooking?.activities as Record<string, unknown> | undefined)?.name as string | undefined;
  const bStatus = sampleBooking?.status as string | undefined;
  const bGuests = sampleBooking?.guests as number | undefined;
  const bCurrency = sampleBooking?.booking_currency as string | undefined;

  const tRef = sampleTrip?.trip_ref as string | undefined;
  const tActivity = (sampleTrip?.activities as Record<string, unknown> | undefined)?.name as string | undefined;
  const tBoat = (sampleTrip?.boats as Record<string, unknown> | undefined)?.name as string | undefined;
  const tDate = sampleTrip?.trip_date as string | undefined;
  const tTime = sampleTrip?.start_time as string | undefined;
  const tDestination = sampleTrip?.destination as string | undefined;
  const tStatus = sampleTrip?.status as string | undefined;

  return (
    <>
      {/* Live example boxes */}
      <div className="adminSection">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: "#075eb7" }}>
            Live Examples — use these to walk through with your staff
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a
              href="/api/admin/orientation/pdf?download=1"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                fontSize: 12,
                fontWeight: 700,
                color: "#fff",
                textDecoration: "none",
                padding: "7px 14px",
                background: "#075eb7",
                borderRadius: 6,
              }}
            >
              ↓ Download Guide (PDF)
            </a>
            <a
              href="/api/admin/orientation/pdf"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                fontSize: 12,
                fontWeight: 700,
                color: "#075eb7",
                textDecoration: "none",
                padding: "7px 14px",
                background: "#e7f1fd",
                borderRadius: 6,
                border: "1px solid #bfdbfe",
              }}
            >
              View / Print PDF
            </a>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: "14px 18px", border: "1px solid #e2e8f0", borderLeft: "4px solid #075eb7" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", marginBottom: 8 }}>Recent Booking</div>
            {sampleBooking ? (
              <div style={{ fontSize: 13, lineHeight: 1.8, color: "#475569" }}>
                <div><span style={{ color: "#64748b" }}>Ref:</span> <strong style={{ color: "#0f172a" }}>{bRef}</strong></div>
                <div><span style={{ color: "#64748b" }}>Guest:</span> {bName || "—"}</div>
                <div><span style={{ color: "#64748b" }}>Activity:</span> {bActivity || "—"}</div>
                <div><span style={{ color: "#64748b" }}>Pax:</span> {bGuests ?? "—"}</div>
                <div><span style={{ color: "#64748b" }}>Status:</span> {bStatus}</div>
                <div><span style={{ color: "#64748b" }}>Currency:</span> {bCurrency || "USD"}</div>
              </div>
            ) : (
              <div style={{ color: "#94a3b8", fontSize: 13 }}>No bookings yet — the steps below apply to any future booking.</div>
            )}
          </div>
          <div style={{ background: "#fff", borderRadius: 10, padding: "14px 18px", border: "1px solid #e2e8f0", borderLeft: "4px solid #16a34a" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", marginBottom: 8 }}>Upcoming Trip</div>
            {sampleTrip ? (
              <div style={{ fontSize: 13, lineHeight: 1.8, color: "#475569" }}>
                <div><span style={{ color: "#64748b" }}>Ref:</span> <strong style={{ color: "#0f172a" }}>{tRef}</strong></div>
                <div><span style={{ color: "#64748b" }}>Activity:</span> {tActivity || "—"}</div>
                <div><span style={{ color: "#64748b" }}>Boat:</span> {tBoat || "—"}</div>
                <div><span style={{ color: "#64748b" }}>Date:</span> {tDate} {tTime ? `at ${tTime}` : ""}</div>
                {tDestination && <div><span style={{ color: "#64748b" }}>Destination:</span> {tDestination}</div>}
                <div><span style={{ color: "#64748b" }}>Status:</span> {tStatus}</div>
              </div>
            ) : (
              <div style={{ color: "#94a3b8", fontSize: 13 }}>No upcoming trips — create one from the Trips page (Step D).</div>
            )}
          </div>
        </div>
      </div>

      {/* A→Z Steps */}
      <div className="adminSection">
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: "#075eb7", marginBottom: 14 }}>
          Complete Workflow — follow in order
        </div>
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
          {STEPS.map((step, i) => {
            const isOpen = expanded === step.letter;
            return (
              <div key={step.letter} style={{ borderTop: i === 0 ? "none" : "1px solid #eef2f7" }}>
                <button
                  onClick={() => setExpanded(isOpen ? null : step.letter)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    width: "100%",
                    background: isOpen ? "#f8fafc" : "#fff",
                    border: "none",
                    cursor: "pointer",
                    padding: "12px 16px",
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: isOpen ? "#075eb7" : "#e7f1fd",
                    color: isOpen ? "#fff" : "#075eb7",
                    fontWeight: 800,
                    fontSize: 13,
                    flexShrink: 0,
                  }}>
                    {step.letter}
                  </span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: isOpen ? "#075eb7" : "#0f172a" }}>
                      {step.title}
                    </span>
                    <span style={{ fontSize: 12, color: "#64748b", marginLeft: 10 }}>
                      → {step.page}
                    </span>
                  </div>
                  <span style={{ fontSize: 16, color: "#94a3b8", transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>
                    ▾
                  </span>
                </button>
                {isOpen && (
                  <div style={{ padding: "0 16px 16px 62px", fontSize: 13, lineHeight: 1.7, color: "#475569" }}>
                    <div style={{ marginBottom: 8 }}>
                      <strong style={{ color: "#0f172a" }}>What to do:</strong> {step.what}
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <strong style={{ color: "#0f172a" }}>Why it matters:</strong> {step.why}
                    </div>
                    {step.tip && (
                      <div style={{
                        background: "#e7f1fd",
                        borderRadius: 8,
                        padding: "10px 14px",
                        borderLeft: "3px solid #075eb7",
                        fontSize: 12,
                        color: "#334155",
                      }}>
                        <strong style={{ color: "#075eb7" }}>Tip:</strong> {step.tip}
                      </div>
                    )}
                    <div style={{ marginTop: 10 }}>
                      <a
                        href={step.href}
                        style={{
                          display: "inline-block",
                          fontSize: 12,
                          fontWeight: 700,
                          color: "#fff",
                          textDecoration: "none",
                          padding: "6px 14px",
                          background: "#075eb7",
                          borderRadius: 6,
                        }}
                      >
                        Open {step.page} →
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}