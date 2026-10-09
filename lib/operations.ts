// Shared helpers for the Operations module (ops board, trips, manifests).

export const TRIP_STATUS_ORDER = ["planned", "ready", "departed", "returned"] as const;
export type TripStatus = (typeof TRIP_STATUS_ORDER)[number] | "cancelled";

export const TRIP_STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  ready: "Ready",
  departed: "Departed",
  returned: "Returned",
  cancelled: "Cancelled",
};

export const BOAT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  maintenance: "Maintenance",
  training: "Training",
};

export interface ManifestBooked {
  booking_ref?: string;
  status?: string;
  payment_status?: string;
  source?: string;
  preferred_time?: string;
  special_requests?: string;
  partner?: string;
  guests?: number;
  estimated_total_cents?: number;
  total_cents?: number;
  net_cents?: number;
  commission_cents?: number;
  booking_currency?: string;
  customers?: { full_name?: string; phone?: string; hotel?: string; room_number?: string } | null;
  consent_forms?: { status?: string; signed_at?: string | null }[] | null;
}

export interface ManifestRow {
  id: string;
  pax: number;
  guest_name: string;
  arrival_date?: string | null;
  arrival_time?: string | null;
  transfer?: string | null;
  hotel?: string | null;
  room_number?: string | null;
  special_requests?: string | null;
  checked_in: boolean;
  bookings?: ManifestBooked | ManifestBooked[] | null;
}

export interface TripRow {
  id: string;
  trip_ref: string;
  activity_id: string;
  boat_id?: string | null;
  guide_id?: string | null;
  captain_id?: string | null;
  trip_date: string;
  start_time?: string | null;
  end_time?: string | null;
  capacity_pax: number;
  seats_open: number;
  status: string;
  notes?: string | null;
  destination?: string | null;
  transfer_price_cents?: number | null;
  transfer_currency?: string | null;
  activities?: { name?: string; slug?: string; category?: string } | null;
  boats?: { name?: string; boat_type?: string; capacity_pax?: number; status?: string } | null;
  guide?: GuideOrCaptain | null;
  captain?: GuideOrCaptain | null;
  trip_manifest?: ManifestRow[] | null;
}

export interface GuideOrCaptain {
  full_name?: string;
  role?: string;
  phone?: string | null;
  staff_profile_id?: string | null;
  staff?: { full_name?: string; phone?: string | null } | null;
}

export function manifestList(trip: TripRow): ManifestRow[] {
  const m = trip.trip_manifest;
  return Array.isArray(m) ? m : [];
}

export function tripGuide(trip: TripRow): { name: string; phone?: string | null; crewId?: string | null } | null {
  const g = trip.guide;
  if (!g || !g.full_name) return null;
  return {
    name: g.full_name,
    phone: g.phone || g.staff?.phone || null,
    crewId: trip.guide_id ?? null,
  };
}

export function tripCaptain(trip: TripRow): { name: string; phone?: string | null; crewId?: string | null; staffProfileId?: string | null } | null {
  const c = trip.captain;
  if (!c || !c.full_name) return null;
  return {
    name: c.full_name,
    phone: c.phone || null,
    crewId: trip.captain_id ?? null,
    staffProfileId: c.staff_profile_id ?? null,
  };
}

export function manifestBooked(manifest: ManifestRow[]): ManifestBooked[] {
  const out: ManifestBooked[] = [];
  for (const row of manifest) {
    if (Array.isArray(row.bookings)) {
      out.push(...(row.bookings as ManifestBooked[]).filter(Boolean));
    } else if (row.bookings) {
      out.push(row.bookings as ManifestBooked);
    }
  }
  return out;
}

/** Consent state for a booking: "signed", "pending", or null (no consent form). */
export function bookingConsentStatus(booking: ManifestBooked | undefined): "signed" | "pending" | "none" {
  const forms = booking?.consent_forms;
  if (!forms || !Array.isArray(forms) || forms.length === 0) return "none";
  if (forms.some((f) => f.status === "signed")) return "signed";
  if (forms.some((f) => f.status === "pending")) return "pending";
  return "none";
}

export function tripBookedPax(trip: TripRow): number {
  return manifestList(trip).reduce((sum, m) => sum + (Number(m.pax) || 0), 0);
}

export function tripCheckedInPax(trip: TripRow): number {
  return manifestList(trip).reduce((sum, m) => sum + (m.checked_in ? Number(m.pax) || 0 : 0), 0);
}

export function tripRemainingSeats(trip: TripRow): number {
  return Math.max(trip.capacity_pax - tripBookedPax(trip), 0);
}

export function tripRevenueCents(trip: TripRow): number {
  return manifestList(trip).reduce((sum, m) => {
    const b = Array.isArray(m.bookings) ? m.bookings[0] : m.bookings;
    if (!b) return sum;
    const net = Number(b.net_cents) || 0;
    const gross = Number(b.total_cents) || Number(b.estimated_total_cents) || 0;
    return sum + (net > 0 ? net : gross);
  }, 0);
}

export function tripCommissionCents(trip: TripRow): number {
  return manifestList(trip).reduce((sum, m) => {
    const b = Array.isArray(m.bookings) ? m.bookings[0] : m.bookings;
    return sum + (Number(b?.commission_cents) || 0);
  }, 0);
}

export function nextTripStatus(status: string): string | null {
  if (status === "planned") return "ready";
  if (status === "ready") return "departed";
  if (status === "departed") return "returned";
  return null;
}

export function prevTripBackAllowed(status: string): boolean {
  return status === "departed";
}

/** Current date in Maldives time (UTC+5) as YYYY-MM-DD. */
export function maldivesToday(): string {
  return new Date(new Date().getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function friendlyDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}