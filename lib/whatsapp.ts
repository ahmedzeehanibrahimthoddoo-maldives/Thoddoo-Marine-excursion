import { WHATSAPP_NUMBERS } from "./data";
import type { WhatsAppParams } from "./types";

const BASE_URL = "https://wa.me";

export function buildWhatsAppLink(params: WhatsAppParams = {}): string {
  const phone = WHATSAPP_NUMBERS[0];

  const parts: string[] = ["Hello Thoddoo Marine,"];

  if (params.activity) {
    parts.push(`I would like to enquire about ${params.activity}.`);
  } else {
    parts.push("I would like to enquire about an activity.");
  }

  if (params.option) {
    parts.push(`Option: ${params.option}`);
  }
  if (params.date) {
    parts.push(`Preferred date: ${params.date}`);
  }
  if (params.guests) {
    parts.push(`Guests: ${params.guests}`);
  }
  if (params.name) {
    parts.push(`Name: ${params.name}`);
  }
  if (params.hotel) {
    parts.push(`Hotel/Guesthouse: ${params.hotel}`);
  }
  if (params.message) {
    parts.push(`Message: ${params.message}`);
  }

  const message = encodeURIComponent(parts.join("\n"));
  return `${BASE_URL}/${phone}?text=${message}`;
}

export function buildGeneralWhatsAppLink(): string {
  return buildWhatsAppLink();
}

export function buildActivityWhatsAppLink(activityName: string): string {
  return buildWhatsAppLink({ activity: activityName });
}

export function buildWatersportWhatsAppLink(
  activityName: string,
  option?: string
): string {
  return buildWhatsAppLink({ activity: activityName, option });
}

export function buildContactWhatsAppLink(params: {
  activity: string;
  name?: string;
  date?: string;
  guests?: number;
  hotel?: string;
  message?: string;
}): string {
  return buildWhatsAppLink(params);
}

/** Clean a phone number into the bare digits wa.me expects (E.164-ish). */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

/** Pretty display for a wa.me digit string, e.g. "9609472110" -> "+960 947 2110". */
export function formatWaNumber(digits: string): string {
  const d = normalizePhone(digits);
  if (d.startsWith("960") && d.length === 10)
    return `+960 ${d.slice(3, 6)} ${d.slice(6)}`;
  if (d.startsWith("62") && d.length === 13)
    return `+62 ${d.slice(2, 5)} ${d.slice(5, 9)} ${d.slice(9)}`;
  if (d.startsWith("960") && d.length > 3)
    return `+960 ${d.slice(3, 6)} ${d.slice(6)}`;
  return `+${d}`;
}

/** Tap-to-send WhatsApp link to a specific recipient with a prepared message. */
export function buildStaffWhatsAppLink(phone: string, message: string): string {
  const digits = normalizePhone(phone);
  if (!digits) return "";
  return `${BASE_URL}/${digits}?text=${encodeURIComponent(message)}`;
}

/** Desktop-first deep link that opens the chat directly in WhatsApp Web. */
export function buildWhatsAppWebLink(phone: string, message: string): string {
  const digits = normalizePhone(phone);
  if (!digits) return "";
  return `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(message)}`;
}

/** Notify a guide/captain that they have been assigned to a trip. */
export function buildTripAssignmentMessage(tripRef: string, activityName: string, date: string, time: string, roleLabel: string): string {
  return `Hello! You have been assigned as ${roleLabel} for trip ${tripRef}:\nActivity: ${activityName}\nDate: ${date}\nTime: ${time || "—"}.\nPlease confirm and check the operations board. Thank you, Thoddoo Marine.`;
}

/** Send the guest the consent-signing (QR check-in) link. */
export function buildConsentInviteMessage(guestName: string, activityName: string, date: string, signingUrl: string): string {
  return `Hi ${guestName}, Thoddoo Marine here! Please sign your consent form for ${activityName} (${date}) and check in by opening this link on your device:\n${signingUrl}\nThank you!`;
}

/* ---------- Quick-send templates used across the admin ------------- */

export interface WhatsAppTemplate {
  label: string;
  build: (ctx: { guestName: string; activity?: string; date?: string; time?: string; reference?: string; amount?: string; url?: string }) => string;
}

export const WHATSAPP_TEMPLATES: WhatsAppTemplate[] = [
  {
    label: "Generic greeting",
    build: ({ guestName }) =>
      `Hello ${guestName}, this is Thoddoo Marine Excursion. How can we help you today?`,
  },
  {
    label: "Booking confirmation",
    build: ({ guestName, activity, date, time, reference }) =>
      `Hi ${guestName}, your booking is confirmed${activity ? ` for ${activity}` : ""}${date ? ` on ${date}` : ""}${time ? ` at ${time}` : ""}.${reference ? `\nRef: ${reference}` : ""}\nSee you at the beach! - Thoddoo Marine`,
  },
  {
    label: "Payment reminder",
    build: ({ guestName, activity, date, amount, reference }) =>
      `Hi ${guestName}, just a reminder about the outstanding payment${activity ? ` for ${activity}` : ""}${date ? ` on ${date}` : ""}${amount ? ` (${amount})` : ""}.${reference ? `\nRef: ${reference}` : ""}\nPlease settle at the counter or contact us. - Thoddoo Marine`,
  },
  {
    label: "Consent / signature",
    build: ({ guestName, activity, date, url }) =>
      `Hi ${guestName}, please review and sign the consent form${activity ? ` for ${activity}` : ""}${date ? ` (${date})` : ""} before joining:\n${url || "..."}\nThank you - Thoddoo Marine`,
  },
  {
    label: "Cancellation notice",
    build: ({ guestName, activity, date, reference }) =>
      `Hi ${guestName}, we're sorry to inform you that your ${activity || "booking"}${date ? ` on ${date}` : ""}${reference ? ` (ref ${reference})` : ""} has been cancelled. We hope to host you another time. - Thoddoo Marine`,
  },
  {
    label: "Trip reminder",
    build: ({ guestName, activity, date, time }) =>
      `Hi ${guestName}, reminder — you're booked${activity ? ` for ${activity}` : ""}${date ? ` on ${date}` : ""}${time ? ` at ${time}` : ""}. Please arrive 15 minutes early at the watersports counter. - Thoddoo Marine`,
  },
];

export function buildTemplateMessage(label: string, ctx: Parameters<WhatsAppTemplate["build"]>[0], fallback?: string): string {
  const t = WHATSAPP_TEMPLATES.find((x) => x.label === label);
  return t ? t.build(ctx) : fallback || "";
}

/** Convenience builders for server-side auto-send (OpenWA / fallback links). */
export function buildBookingConfirmationMessage(ctx: { guestName: string; activity?: string; date?: string; time?: string; reference?: string }): string {
  return buildTemplateMessage("Booking confirmation", ctx, `Hi ${ctx.guestName}, your booking is confirmed. - Thoddoo Marine`);
}

export function buildPaymentReminderMessage(ctx: { guestName: string; activity?: string; date?: string; amount?: string; reference?: string }): string {
  return buildTemplateMessage("Payment reminder", ctx, `Hi ${ctx.guestName}, please settle your outstanding payment. - Thoddoo Marine`);
}
