import type { jsPDF } from "jspdf";

export function renderConsentText(doc: jsPDF, text: string, startY: number): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const maxWidth = pageWidth - margin * 2;
  const fontSize = 9;
  const lineSpacing = 3.9; // comfortable professional line height (mm)
  let y = startY;

  function drawLines(pieces: string[], x: number, w: number) {
    doc.setFontSize(fontSize);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 40, 50);
    for (const piece of pieces) {
      if (y > 268) {
        doc.addPage();
        y = 18;
      }
      doc.text(piece, x, y, { maxWidth: w });
      y += lineSpacing;
    }
  }

  const lines = text.split("\n");

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();

    // Blank line: paragraph gap
    if (!trimmed) {
      y += 2;
      continue;
    }

    const isHeading = /^\d{1,2}\.\s+[A-Z]/.test(trimmed) && trimmed.toUpperCase() === trimmed;
    const isAck = /^ACKNOWLEDGEMENT/i.test(trimmed);
    const isBullet = trimmed.startsWith("-") || trimmed.startsWith("•");

    if (isHeading || isAck) {
      y += 2;
      doc.setFontSize(9.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(7, 57, 111);
      doc.text(line, margin, y, { maxWidth });
      y += lineSpacing + 1;
      continue;
    }

    if (isBullet) {
      const bulletText = "• " + line.replace(/^\s*[-•]+\s*/, "");
      drawLines(doc.splitTextToSize(bulletText, maxWidth - 5), margin + 2, maxWidth - 5);
      continue;
    }

    drawLines(doc.splitTextToSize(line, maxWidth), margin, maxWidth);
  }

  return y;
}

export function drawSignature(
  doc: jsPDF,
  dataUrl: string | null,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  signatureProvided?: boolean,
): number {
  // Case 1: signature was never provided (null/empty and caller knows it wasn't provided)
  if (!dataUrl && signatureProvided !== true) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.text("Not provided", x, y + h / 2 + 2);
    return y + h;
  }

  // Case 2: signature data exists but is invalid/unreadable
  if (
    !dataUrl ||
    (!dataUrl.startsWith("data:image/png;base64,") &&
     !dataUrl.startsWith("data:image/jpeg;base64,") &&
     !dataUrl.startsWith("data:image/jpg;base64,"))
  ) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.text("Signature image unavailable", x, y + h / 2 + 2);
    return y + h;
  }

  try {
    const headerEnd = dataUrl.indexOf(",");
    if (headerEnd === -1) throw new Error("Invalid data URL");
    const base64 = dataUrl.slice(headerEnd + 1);

    // Pre-decode length limit: max 524,288 decoded bytes ≈ 699,050 base64 chars
    if (base64.length > 699050) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.text("Signature image unavailable (too large)", x, y + h / 2 + 2);
      return y + h;
    }

    const decoded = atob(base64);
    if (decoded.length > 524288) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.text("Signature image unavailable (too large)", x, y + h / 2 + 2);
      return y + h;
    }

    const fmt = dataUrl.includes("image/png") ? "PNG" : "JPEG";

    // Fit the signature inside the box instead of stretching it to fill it.
    // A signature is mostly a horizontal line, so forcing it into a fixed
    // 70x20mm frame stretched the short axis and thinned the ink to what looked
    // like a plain rule. Scale to whichever axis binds first and sit on the
    // baseline of the box.
    let drawW = w;
    let drawH = h;
    try {
      const props = doc.getImageProperties(dataUrl);
      const pw = Number(props?.width);
      const ph = Number(props?.height);
      if (pw > 0 && ph > 0) {
        const scale = Math.min(w / pw, h / ph);
        drawW = pw * scale;
        drawH = ph * scale;
      }
    } catch {
      // Unknown dimensions: fall back to the full box.
    }

    doc.addImage(dataUrl, fmt, x, y + (h - drawH), drawW, drawH);
  } catch {
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.text("Signature image unavailable", x, y + h / 2 + 2);
  }

  return y + h;
}

export interface ConsentPdfData {
  id: string;
  guest_name: string;
  activity_name: string;
  booking_ref: string | null;
  nationality: string | null;
  date_of_birth: string | null;
  phone: string | null;
  hotel: string | null;
  room_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  swimming_ability: string | null;
  medical_conditions: string | null;
  allergies: string | null;
  medications: string | null;
  recent_injuries: string | null;
  is_pregnant: boolean;
  safety_briefing_confirmed: boolean;
  life_jacket_confirmed: boolean;
  risk_acknowledged: boolean;
  photo_consent: boolean;
  is_minor: boolean;
  parent_guardian_name: string | null;
  witness_name: string | null;
  signature_data_url: string | null;
  witness_signature_data_url: string | null;
  parent_guardian_signature_data_url: string | null;
  status: string;
  consent_version: string | null;
  consent_text_snapshot: string | null;
  signed_at: string | null;
  created_at: string | null;
  signing_method: string | null;
  signed_by_staff_name: string | null;
  consent_type?: string | null;
}

function versionDisplay(data: ConsentPdfData): string {
  return data.consent_version || "Legacy record — consent text/version was not captured by this system.";
}

const NAVY = [7, 57, 111] as const;
const CYAN = [52, 190, 210] as const;
const GRAY = [100, 121, 147] as const;
const LIGHT_BG = [248, 250, 252] as const;

function formatMaldivesDate(isoString: string | null): string {
  if (!isoString) return "—";
  try {
    return new Date(isoString).toLocaleString("en-GB", {
      timeZone: "Indian/Maldives",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

export async function generateConsentPdf(
  data: ConsentPdfData,
  logoDataUrl?: string | null,
): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  function addPageNumberFooter() {
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GRAY);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 8, { align: "center" });
      doc.text(
        `Generated: ${formatMaldivesDate(new Date().toISOString())}`,
        margin,
        pageHeight - 8,
      );
      doc.text("Thoddoo Marine Excursion Centre", pageWidth - margin, pageHeight - 8, {
        align: "right",
      });
    }
  }

  function checkPageBreak(needed: number) {
    if (y + needed > pageHeight - 20) {
      doc.addPage();
      y = margin;
    }
  }

  function addSectionTitle(title: string) {
    checkPageBreak(14);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text(title, margin, y);
    y += 2;
    doc.setDrawColor(...CYAN);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
  }

  function addField(label: string, value: string | null | boolean, indent = 0) {
    const x = margin + indent;
    checkPageBreak(8);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GRAY);
    doc.text(label + ":", x, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
    let displayValue = "—";
    if (typeof value === "boolean") {
      displayValue = value ? "Yes" : "No";
    } else if (value) {
      displayValue = value;
    }
    doc.text(displayValue, x + 45, y);
    y += 5;
  }

  function addFieldFull(label: string, value: string | null, indent = 0) {
    const x = margin + indent;
    checkPageBreak(10);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GRAY);
    doc.text(label + ":", x, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
    const displayValue = value || "—";
    const lines = doc.splitTextToSize(displayValue, contentWidth - indent);
    doc.text(lines, x, y);
    y += lines.length * 4 + 2;
  }

  // --- HEADER ---
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, 28, "F");

  // Logo — supplied by caller as a data URL, no filesystem access
  if (logoDataUrl) {
    try {
      const fmt = logoDataUrl.includes("image/png") ? "PNG" : "JPEG";
      doc.addImage(logoDataUrl, fmt, margin, 4, 18, 18);
    } catch {
      // Logo data invalid — continue without it
    }
  }

  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("THODDOO MARINE EXCURSION CENTRE", pageWidth / 2, 12, { align: "center" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const isRental = data.consent_type === "equipment_rental";
  doc.text(isRental ? "Equipment Rental Liability Consent Form" : "Activity Participation Consent Form", pageWidth / 2, 19, { align: "center" });
  doc.text("Thoddoo, Maldives", pageWidth / 2, 24, { align: "center" });
  y = 36;

  // --- CONSENT HEADER ---
  doc.setFillColor(...LIGHT_BG);
  doc.roundedRect(margin, y, contentWidth, 20, 2, 2, "F");
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text(isRental ? "EQUIPMENT RENTAL LIABILITY CONSENT" : "ACTIVITY PARTICIPATION CONSENT", margin + 4, y + 8);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  const reference = data.booking_ref || data.id.slice(0, 8);
  doc.text(`Consent Reference: ${reference}`, margin + 4, y + 14);
  const statusDisplay = data.status === "signed" ? "SIGNED" : data.status.toUpperCase();
  doc.text(`Status: ${statusDisplay}`, pageWidth - margin - 4, y + 8, { align: "right" });
  doc.text(`Version: ${versionDisplay(data)}`, pageWidth - margin - 4, y + 14, { align: "right" });
  y += 26;

  // --- GUEST INFORMATION ---
  addSectionTitle("GUEST INFORMATION");
  addField("Full Name", data.guest_name);
  addField("Nationality", data.nationality);
  addField("Date of Birth", data.date_of_birth ? formatMaldivesDate(data.date_of_birth) : null);
  addField("Phone", data.phone);
  addField("Hotel", data.hotel);
  addField("Room Number", data.room_number);
  y += 4;

  // --- EMERGENCY CONTACT ---
  addSectionTitle("EMERGENCY CONTACT");
  addField("Contact Name", data.emergency_contact_name);
  addField("Contact Phone", data.emergency_contact_phone);
  y += 4;

  // --- ACTIVITY / EQUIPMENT DETAILS ---
  addSectionTitle(isRental ? "EQUIPMENT DETAILS" : "ACTIVITY DETAILS");
  addField(isRental ? "Equipment Rented" : "Activity", data.activity_name);
  addField("Booking Reference", data.booking_ref);
  y += 4;

  // --- MEDICAL INFORMATION ---
  addSectionTitle("MEDICAL INFORMATION");
  addField("Swimming Ability", data.swimming_ability);
  const hasMedicalInfo =
    data.medical_conditions || data.allergies || data.medications ||
    data.recent_injuries || data.is_pregnant;
  if (hasMedicalInfo) {
    addFieldFull("Medical Conditions", data.medical_conditions);
    addFieldFull("Allergies", data.allergies);
    addFieldFull("Medications", data.medications);
    addFieldFull("Recent Injuries / Surgeries", data.recent_injuries);
    addField("Currently Pregnant", data.is_pregnant);
  } else {
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...GRAY);
    doc.text("No medical conditions or safety concerns were disclosed.", margin, y);
    y += 5;
  }
  y += 4;

  // --- SAFETY ACKNOWLEDGEMENTS ---
  addSectionTitle("SAFETY ACKNOWLEDGEMENTS");
  addField("Safety briefing received", data.safety_briefing_confirmed);
  addField("Life jacket / safety equipment agreed", data.life_jacket_confirmed);
  addField("Risk acknowledged", data.risk_acknowledged);
  addField("Photo / video consent", data.photo_consent);
  y += 4;

  // --- PARENT / GUARDIAN (if minor) ---
  if (data.is_minor) {
    addSectionTitle("PARENT / GUARDIAN CONSENT");
    addField("Parent / Guardian Name", data.parent_guardian_name);
    y += 2;
    checkPageBreak(30);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GRAY);
    doc.text("Parent / Guardian Signature:", margin, y);
    y += 4;
    y = drawSignature(doc, data.parent_guardian_signature_data_url, margin, y, 70, 20, "Parent/Guardian", Boolean(data.parent_guardian_signature_data_url));
    y += 4;
  }

  // --- SIGNATURES ---
  addSectionTitle("SIGNATURES");

  // Guest signature — always required, so signature was provided
  checkPageBreak(30);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GRAY);
  doc.text("Participant Signature:", margin, y);
  y += 4;
  y = drawSignature(doc, data.signature_data_url, margin, y, 70, 20, "Guest", true);
  y += 4;

  // Witness signature
  checkPageBreak(30);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GRAY);
  doc.text("Witness / Staff:", margin, y);
  if (data.witness_name) {
    doc.setFont("helvetica", "normal");
    doc.text(data.witness_name, margin + 30, y);
  }
  y += 4;
  y = drawSignature(doc, data.witness_signature_data_url, margin, y, 70, 20, "Witness", Boolean(data.witness_signature_data_url));
  y += 6;

  // Signing method disclosure
  checkPageBreak(10);
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(...GRAY);
  if (data.signing_method === "staff_assisted" && data.signed_by_staff_name) {
    doc.text(
      "Staff-assisted signing — assisted by: " + data.signed_by_staff_name,
      margin,
      y,
    );
  } else {
    doc.text("Signed by guest using secure consent link.", margin, y);
  }
  y += 5;

  // --- CONSENT TEXT ---
  addSectionTitle("CONSENT TEXT ACCEPTED");
  if (data.consent_text_snapshot) {
    y = renderConsentText(doc, data.consent_text_snapshot, y);
  } else {
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...GRAY);
    doc.text(
      "Legacy record — consent text/version was not captured by this system.",
      margin,
      y,
    );
    y += 5;
  }
  y += 6;

  // --- LEGAL ---
  addSectionTitle("LEGAL DISCLAIMER");
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);
  const legalLines = doc.splitTextToSize(
    "This form records the participant's agreement for the stated activity. " +
    "It does not constitute a blanket waiver of liability. Final liability wording " +
    "should be reviewed under applicable Maldivian law and insurance requirements.",
    contentWidth,
  );
  doc.text(legalLines, margin, y);
  y += legalLines.length * 3.5 + 3;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(
    "NOTICE: This form should be reviewed under applicable Maldivian law.",
    margin,
    y,
  );
  y += 5;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(
    `Electronically signed record. Signed: ${formatMaldivesDate(data.signed_at)} | ` +
    `Version: ${versionDisplay(data)}`,
    margin,
    y,
  );

  addPageNumberFooter();
  const pdfArray = doc.output("arraybuffer");
  return Buffer.from(pdfArray);
}
