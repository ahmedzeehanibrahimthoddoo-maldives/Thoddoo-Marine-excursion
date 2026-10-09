import type { jsPDF } from "jspdf";

export interface BookingFlowPdfOptions {
  generatedBy?: string;
  logoDataUrl?: string | null;
}

const NAVY: [number, number, number] = [0, 64, 128];
const SKY: [number, number, number] = [54, 183, 255];
const GRAY: [number, number, number] = [110, 125, 140];
const LIGHT: [number, number, number] = [226, 235, 245];

const A4_W = 210;
const A4_H = 297;
const M = 22;
const CONTENT_W = A4_W - M * 2;

interface StepBlock {
  letter: string;
  title: string;
  where: string;
  what: string[];
  why: string;
  tip?: string;
}

const LEADER_INSTRUCTIONS = "Always use a waterproof pen and complete this guide during quiet time. Keep this printed guide at the reception counter and in the office.";

const GOLDEN_RULES = [
  "No signed consent form -> the guest does NOT go on the trip.",
  "Every booking must have a clear payment status; any balance must be collected before departure.",
  "Every passenger must be on the trip manifest with correct hotel, room and arrival details.",
];

const STEPS: StepBlock[] = [
  {
    letter: "A",
    title: "Receive Booking",
    where: "Admin > Bookings",
    what: [
      "A booking arrives from one of three sources: the public website booking form, a walk-in guest at the counter, or a manual entry you type in yourself.",
      "Open the Bookings page and confirm the new booking is visible with the correct activity selected.",
      "Confirm 5 things with the guest: the activity, the date, the number of guests, a preferred time, and any special requests.",
      "If you are entering it manually, create the booking and choose: activity, customer, booking date, number of guests and preferred time.",
      "Set the booking status to 'confirmed' once the guest has confirmed the details (leave it 'pending' while you are still waiting for their confirmation).",
    ],
    why: "The booking is the single source of truth for everything that follows. A mistake made here is repeated in the manifest, the consent form, the invoice and the payments.",
    tip: "Always read back the booking to the guest: activity, date, time, number of people and price. Confirming aloud prevents the most common mistakes.",
  },
  {
    letter: "B",
    title: "Create / Find Customer",
    where: "Admin > Customers",
    what: [
      "First SEARCH for the customer by name or phone — do not create a duplicate record for an existing guest.",
      "New guest: create the customer and fill in all required fields: full name, phone, email, nationality, hotel and room number.",
      "Also capture the emergency contact name and phone number, and any medical conditions, allergies or medications.",
      "Link the booking to this customer record so the guest profile shows their history.",
    ],
    why: "The customer record feeds the manifest, the consent form, the invoice and — most importantly — the emergency contact details that protect the guest on the water.",
    tip: "Hotel and room number are essential: the crew uses them for transfers and if the guest leaves anything on the boat.",
  },
  {
    letter: "C",
    title: "Collect Payment",
    where: "Admin > Payments",
    what: [
      "Open the booking and look at payment_status: it will read unpaid, partial or paid.",
      "Confirm the currency with the guest BEFORE taking any money — USD or MVR.",
      "Collect the deposit or the full amount on the Payments page and record: method (cash / card / bank / partner), reference if any, amount and currency.",
      "The system updates the booking balance automatically. A zero balance means the booking is paid in full.",
      "Print or show the receipt (receipt icon) so the guest has a record.",
      "If the booking came from a partner, record the partner name so commissions are tracked automatically.",
    ],
    why: "Payment protects the business. A seat that is paid for is a confirmed seat on the boat. Any outstanding balance must be settled before the guest departs.",
    tip: "At check-in, always glance at the balance column — it is the last chance to collect what is owed.",
  },
  {
    letter: "D",
    title: "Create Trip",
    where: "Admin > Trips",
    what: [
      "Open the Trips page for the requested date.",
      "Click New Trip and choose: the product/activity, the boat from the fleet, the date, the start time and the end time.",
      "Capacity fills automatically from the boat you pick. Check the open seats value.",
      "For Private Boat Hire: also enter the destination island, the price and the currency (USD or MVR).",
      "Initial status: use 'planned' for a normal trip, or 'ready' if it is departing very soon.",
    ],
    why: "The trip is the actual boat departure that will carry the guest's booking. Without a trip there is no seat and no manifest.",
    tip: "Bundle same-activity bookings on the same trip to save fuel and crew shifts — the Ops Board helps you see what is still open.",
  },
  {
    letter: "E",
    title: "Assign Booking to Trip",
    where: "Admin > Ops Board",
    what: [
      "Open the Ops Board, find the trip you created in step D.",
      "Use the quick-assign button (ZAP) or the assign modal to attach the guest's booking to the trip.",
      "Confirm the guest's name now appears on the trip manifest.",
      "If the trip is full, assign to the next suitable trip or create a new one (repeat step D).",
    ],
    why: "Only guests who are booked AND assigned are allowed on the boat — the manifest is the boarding list the crew checks at the jetty.",
    tip: "Pay attention to capacity: the Ops Board turns the capacity bar full when a trip is booked out.",
  },
  {
    letter: "F",
    title: "Assign Crew",
    where: "Admin > Ops Board / Trips",
    what: [
      "Assign a CAPTAIN (boat driver) to the trip — this is mandatory for every single departure.",
      "Assign a GUIDE / instructor for water activities.",
      "Use the WhatsApp button next to the crew member's name to send them the assignment message.",
      "Confirm the crew is available for the date and time before leaving them assigned.",
    ],
    why: "A trip cannot depart without a captain, and the crew must know the schedule and the guest list well in advance.",
    tip: "Confirm crew availability BEFORE assigning. Re-check on the morning of the trip in case someone changed shift.",
  },
  {
    letter: "G",
    title: "Send Consent Form",
    where: "Admin > My Tasks > Consents Pending",
    what: [
      "Open My Tasks and go to the 'Consents Pending' list.",
      "Click 'Send link' next to the booking — the system creates a unique consent link and a WhatsApp message for the guest.",
      "The public consent page explains the activity, the safety rules and the medical declaration the guest must read.",
      "The link is valid for 48 hours. If it expires, regenerate and resend.",
    ],
    why: "Consent is legally required before the guest participates. Without a signed consent the guest cannot go on the trip — this protects the guest AND the company.",
    tip: "Send the consent link the same day the booking is made, while the guest is still reachable.",
  },
  {
    letter: "H",
    title: "Guest Signs Consent",
    where: "Admin > Consents",
    what: [
      "The guest taps the WhatsApp link, reads the safety information and signs the form (draws their signature).",
      "The consent status changes to 'signed' in the system.",
      "From the Consents page, verify the form is signed BEFORE the trip day.",
      "If it is still unsigned, follow up with the guest by phone and send them the link again if needed.",
    ],
    why: "A signed form is proof the guest understood the safety rules and the risk. It is your green light for the trip.",
    tip: "Check unsorted consents every morning — a guest who never signed cannot board.",
  },
  {
    letter: "I",
    title: "Finalize Manifest",
    where: "Admin > Manifests",
    what: [
      "Open the trip manifest and complete each guest's logistics: arrival date, arrival time and transfer details (ferry / boat / flight).",
      "Add the hotel and room number to each row if not already there.",
      "Note any special requests in the remarks.",
      "Review the full manifest on the morning of the trip — every field should be filled.",
    ],
    why: "The crew relies on this to know who is arriving, when, how and where they are staying. Missing transfer info causes missed pickups and angry guests.",
    tip: "Fill the manifest the day before the trip, then just verify it in the morning.",
  },
  {
    letter: "J",
    title: "Check-In Guest",
    where: "Admin > Manifests",
    what: [
      "On trip day, when the guest arrives at the jetty, check them in using the check-in button on the manifest.",
      "Compare the checked-in count against the trip capacity.",
      "If a guest is missing 30 minutes before departure, call the phone number on the booking.",
    ],
    why: "Check-in confirms the guest is physically present and ready. An unchecked guest may be a no-show who blocks a seat someone else could have used.",
    tip: "Greet every guest by name as they arrive — it makes the experience personal and makes headcount easy.",
  },
  {
    letter: "K",
    title: "Mark Trip Ready",
    where: "Admin > Ops Board",
    what: [
      "When the boat is prepared, the crew is briefed and all guests are checked in, mark the trip as 'Ready' (departing soon).",
      "Use the checkmark button on the Ops Board trip card.",
      "The trip card changes colour so the whole team can see it is about to leave.",
    ],
    why: "'Ready' is a clear signal to reception, management and crew that the departure is imminent and everything is in place.",
    tip: "Do your final safety sweep (life jackets, gear, water) BEFORE tapping ready.",
  },
  {
    letter: "L",
    title: "Trip Departed",
    where: "Admin > Ops Board",
    what: [
      "The moment the boat leaves the jetty, mark the trip as 'Departed' (sail button).",
      "The manifest now locks — no more check-ins or edits.",
      "Reception can now tell waiting guests how long until the boat returns.",
    ],
    why: "Locking the manifest stops last-minute changes once the guests are on the water and starts the live leg of the trip.",
    tip: "Only the person physically at the jetty should press departed. Confirm the boat has actually pushed off.",
  },
  {
    letter: "M",
    title: "Trip Complete",
    where: "Admin > Ops Board",
    what: [
      "When the boat returns and guests disembark, mark the trip as 'Returned'.",
      "The trip closes and the boat becomes available for the next departure.",
      "Note any incidents or guest feedback so the owner can review.",
    ],
    why: "Closing the trip completes the operational loop and keeps the boat's schedule accurate for the rest of the day.",
    tip: "If a guest reports a lost item, note it in the trip remarks and alert reception before they leave the jetty.",
  },
  {
    letter: "N",
    title: "Confirm & Close",
    where: "Admin > Bookings",
    what: [
      "Final check on the booking: payment_status is 'paid', the consent form is 'signed', and the manifest is complete.",
      "If any balance is still outstanding, collect it now.",
      "The booking is now fully complete and can be closed for reports.",
    ],
    why: "A clean booking — paid, signed and logged — makes accounting, reports and partner statements accurate at the end of the day.",
    tip: "Spend 5 quiet minutes at closing time double-checking today's departures. It removes 90% of tomorrow's problems.",
  },
];

const ROLES = [
  ["Owner / Manager", "Oversight, pricing, staff management, reports and settings."],
  ["Reception", "Bookings, payments, customer details, sending consent forms, manifest logistics."],
  ["Watersports Staff", "Trips, crew, equipment, guiding guests through the water activities."],
  ["Boat Crew", "Operating the boats, safety on board, assisting guests on and off the boat."],
];

const DAILY_CHECKLIST = [
  "Open the Ops Board and review today's trips",
  "Confirm every guest today has a SIGNED consent form",
  "Confirm every booking today is PAID (or balance noted)",
  "Check manifest details are complete (arrival, transfer, hotel, room)",
  "Confirm captain + guide are assigned and notified",
  "Do a safety sweep of the boat, life jackets and gear",
];

function ensure(doc: jsPDF, needed: number, y: number, marginTop = 24): number {
  if (y + needed > A4_H - 18) {
    doc.addPage();
    return marginTop;
  }
  return y;
}

function footer(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text(
      "Thoddoo Marine Excursion Centre — Staff Orientation - Page " + i + " of " + pageCount,
      A4_W / 2,
      A4_H - 10,
      { align: "center" },
    );
  }
}

function renderWhatList(doc: jsPDF, margin: number, items: string[], startY: number): number {
  let y = startY;
  for (const item of items) {
    y = ensure(doc, 16, y);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(item, CONTENT_W - 10);
    doc.setTextColor(...GRAY);
    doc.text("•", margin + 1, y);
    doc.text(lines[0] as string, margin + 5, y);
    for (let i = 1; i < lines.length; i++) {
      y += 5.2;
      if (y > A4_H - 24) { doc.addPage(); y = 24; }
      doc.text(lines[i] as string, margin + 5, y);
    }
    y += (lines.length > 1 ? 5.2 : 6.5);
  }
  return y + 2;
}

export async function generateBookingFlowPdf(
  opts: BookingFlowPdfOptions = {},
): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = M;

  // ---- Header ----
  if (opts.logoDataUrl) {
    try {
      const fmt = opts.logoDataUrl.includes("image/png") ? "PNG" : "JPEG";
      doc.addImage(opts.logoDataUrl, fmt, A4_W / 2 - 13, 9, 26, 26);
    } catch { /* ignore */ }
  }
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...NAVY);
  doc.text("Thoddoo, Maldives", A4_W / 2, 40, { align: "center" });

  let y = 50;
  doc.setFontSize(17);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text("STAFF ORIENTATION", A4_W / 2, y, { align: "center" });
  y += 7;
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text("Guest Booking Flow — Step by Step in the System", A4_W / 2, y, { align: "center" });
  y += 8;
  doc.setTextColor(...GRAY);
  doc.setFontSize(9);
  doc.text("For Thoddoo Marine Excursion Centre staff. Follow every step for EVERY booking.", A4_W / 2, y, { align: "center" });
  y += 8;

  doc.setDrawColor(...SKY);
  doc.setLineWidth(0.6);
  doc.line(margin, y, A4_W - margin, y);
  y += 5;

  // ---- How to use ----
  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text("How to use this guide", margin, y);
  y += 6;
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  const howLines = doc.splitTextToSize(
    "Each step is a letter, A to N, in the exact order you will work through it in the system. For every step it tells you WHICH page to open, WHAT to do there and WHY it matters. Keep this guide printed at the counter and next to the office computer.",
    CONTENT_W,
  );
  for (const l of howLines) {
    doc.text(l as string, margin, y);
    y += 5.2;
  }
  y += 5;

  // ---- Golden rules ----
  y = ensure(doc, 60, y);
  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text("The 3 Golden Rules", margin, y);
  y += 6;
  for (const rule of GOLDEN_RULES) {
    y = ensure(doc, 16, y);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(rule, CONTENT_W - 10);
    doc.setTextColor(...SKY);
    doc.text("*", margin, y);
    doc.setTextColor(...GRAY);
    doc.text(lines[0] as string, margin + 6, y);
    for (let i = 1; i < lines.length; i++) {
      y += 5.2;
      if (y > A4_H - 24) { doc.addPage(); y = 24; }
      doc.text(lines[i] as string, margin + 6, y);
    }
    y += 5;
  }

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(...GRAY);
  y += 2;
  const instructionLines = doc.splitTextToSize(LEADER_INSTRUCTIONS, CONTENT_W);
  for (const l of instructionLines) {
    doc.text(l as string, margin, y);
    y += 5.2;
  }
  y += 6;

  // ---- Steps ----
  for (const step of STEPS) {
    y = ensure(doc, 46, y);
    doc.setFillColor(...LIGHT);
    doc.roundedRect(margin, y - 5, CONTENT_W, 10, 2, 2, "F");
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("STEP " + step.letter + "  —  " + step.title.toUpperCase(), margin + 4, y + 1);
    y += 9;

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...SKY);
    doc.text("WHERE IN THE SYSTEM", margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text(step.where, margin + 40, y);
    y += 6;

    doc.setFontSize(9.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("What to do", margin, y);
    y += 5;

    y = renderWhatList(doc, margin, step.what, y);

    doc.setFontSize(9.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("Why it matters", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    const whyLines = doc.splitTextToSize(step.why, CONTENT_W);
    for (const l of whyLines) {
      y = ensure(doc, 8, y);
      doc.text(l as string, margin, y);
      y += 4.6;
    }
    y += 2;

    if (step.tip) {
      y = ensure(doc, 20, y);
      doc.setFontSize(9);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(...SKY);
      const tipLines = doc.splitTextToSize("Tip: " + step.tip, CONTENT_W - 8);
      for (const l of tipLines) {
        if (y > A4_H - 24) { doc.addPage(); y = 24; }
        doc.text(l as string, margin + 3, y);
        y += 4.4;
      }
      y += 4;
    }

    y += 2;
  }

  // ---- Roles ----
  y = ensure(doc, 60, y);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text("Who Does What", margin, y);
  y += 6;
  for (const [role, desc] of ROLES) {
    y = ensure(doc, 14, y);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text(role + ":", margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    const roleLines = doc.splitTextToSize(desc, CONTENT_W - 45);
    doc.text(roleLines[0] as string, margin + 42, y);
    if (roleLines.length > 1) {
      for (let i = 1; i < roleLines.length; i++) {
        y += 5.2;
        if (y > A4_H - 24) { doc.addPage(); y = 24; }
        doc.text(roleLines[i] as string, margin + 42, y);
      }
    }
    y += 6;
  }

  // ---- Daily checklist ----
  y = ensure(doc, 60, y);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text("Daily Morning Checklist", margin, y);
  y += 6;
  for (const item of DAILY_CHECKLIST) {
    y = ensure(doc, 10, y);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text("[ ]  " + item, margin, y);
    y += 6;
  }

  // ---- Signature ----
  y = ensure(doc, 34, y + 6);
  y += 8;
  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text("I have read and understood the guest booking flow and will follow it for every booking.", margin, y);
  y += 6;
  doc.setFontSize(9.5);
  doc.setTextColor(...GRAY);
  doc.text("Staff member name: ______________________________", margin, y);
  y += 6;
  doc.text("Signature: ______________________________________               Date: _______________", margin, y);

  footer(doc);

  const pdfArray = doc.output("arraybuffer");
  return Buffer.from(pdfArray);
}