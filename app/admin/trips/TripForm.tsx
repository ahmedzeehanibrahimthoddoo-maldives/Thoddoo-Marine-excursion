"use client";

import { useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { createTripAction, updateTripAction } from "@/lib/supabase/actions";
import { maldivesToday, TripRow } from "@/lib/operations";

interface SelectOption { id: string; label: string; sub?: string; capacity_pax?: number; status?: string; slug?: string; }

interface TripFormProps {
  open: boolean;
  onClose: () => void;
  trip?: TripRow;
  activities: SelectOption[];
  boats: SelectOption[];
  crew: SelectOption[];
  onSaved: (msg: string) => void;
}

const ISLANDS = [
  "Thoddoo", "Ukulhas", "Mathiveri", "Bodufolhudhoo",
  "Maalhos", "Dhiyamigili", "Thoddoo",
];

export default function TripForm({ open, onClose, trip, activities, boats, crew, onSaved }: TripFormProps) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [form, setForm] = useState(() => ({
    activity_id: trip?.activity_id || "",
    boat_id: (trip?.boat_id as string) || "",
    trip_date: trip?.trip_date || maldivesToday(),
    start_time: trip?.start_time || "",
    end_time: trip?.end_time || "",
    guide_id: (trip?.guide_id as string) || "",
    captain_id: (trip?.captain_id as string) || "",
    capacity_pax: String(trip?.capacity_pax ?? ""),
    seats_open: String(trip?.seats_open ?? ""),
    status: "planned",
    notes: trip?.notes || "",
    destination: trip?.destination || "",
    transfer_price_cents: trip?.transfer_price_cents != null ? String((trip.transfer_price_cents as number) / 100) : "",
    transfer_currency: trip?.transfer_currency || "USD",
  }));

  const selectedActivity = activities.find((a) => a.id === form.activity_id);
  const isHire = selectedActivity?.slug === "private-boat-hire";

  function set(field: string, value: string) {
    if (field === "boat_id") {
      const boat = boats.find((b) => b.id === value);
      setForm((prev) => ({
        ...prev,
        boat_id: value,
        capacity_pax: boat?.capacity_pax ? String(boat.capacity_pax) : prev.capacity_pax,
        seats_open: boat?.capacity_pax ? String(boat.capacity_pax) : prev.seats_open,
      }));
      return;
    }
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.activity_id) {
      setToast({ type: "error", message: "Product is required." });
      return;
    }
    if (!form.boat_id) {
      setToast({ type: "error", message: "Boat is required — pick the craft that runs this trip." });
      return;
    }
    if (!form.trip_date) {
      setToast({ type: "error", message: "Trip date is required." });
      return;
    }

    startTransition(async () => {
      try {
        const payload: Record<string, unknown> = {
          activity_id: form.activity_id,
          boat_id: form.boat_id,
          trip_date: form.trip_date,
          start_time: form.start_time || null,
          end_time: form.end_time || null,
          guide_id: form.guide_id || null,
          captain_id: form.captain_id || null,
          capacity_pax: form.capacity_pax ? Number(form.capacity_pax) : null,
          seats_open: form.seats_open ? Number(form.seats_open) : null,
          notes: form.notes || null,
        };
        if (isHire) {
          payload.destination = form.destination || null;
          payload.transfer_price_cents = form.transfer_price_cents ? Math.round(Number(form.transfer_price_cents) * 100) : null;
          payload.transfer_currency = form.transfer_currency;
        }
        if (trip?.id) {
          await updateTripAction(trip.id, payload);
          onSaved(`Trip updated.`);
        } else {
          await createTripAction({ ...payload, status: form.status });
          onSaved(`Trip created.`);
        }
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save trip." });
      }
    });
  }

  const boatSelected = boats.find((b) => b.id === form.boat_id);

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={trip ? `Edit Trip ${trip.trip_ref}` : "New Trip"}
      wide
      footer={
        <>
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" form="trip-form" className="formSubmit" disabled={pending}>
            {pending ? "Saving..." : trip ? "Update Trip" : "Create Trip"}
          </button>
        </>
      }
    >
      {toast && <Toast type={toast.type} message={toast.message} />}
      <form id="trip-form" onSubmit={handleSubmit}>
        <FormRow cols={2}>
          <FormField label="Product" htmlFor="activity_id" required>
            <select id="activity_id" value={form.activity_id} onChange={(e) => set("activity_id", e.target.value)}>
              <option value="">Select product…</option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Trip Date" htmlFor="trip_date" required>
            <input id="trip_date" type="date" value={form.trip_date} onChange={(e) => set("trip_date", e.target.value)} />
          </FormField>
        </FormRow>
        <FormRow cols={2}>
          <FormField label="Boat / Fleet" htmlFor="boat_id" required hint={boatSelected ? `Capacity ${boatSelected.capacity_pax} pax · ${boatSelected.sub}` : undefined}>
            <select id="boat_id" value={form.boat_id} onChange={(e) => set("boat_id", e.target.value)}>
              <option value="">Select boat…</option>
              {boats.map((b) => (
                <option key={b.id} value={b.id} disabled={b.status === "maintenance"}>
                  {b.label}{b.status === "maintenance" ? " (maintenance)" : ""}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Number of Pax" htmlFor="capacity_pax" hint="Auto-set from boat when you pick one.">
            <input id="capacity_pax" type="number" min="1" value={form.capacity_pax} onChange={(e) => set("capacity_pax", e.target.value)} />
          </FormField>
        </FormRow>

        {isHire && (
          <div style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 16px", marginBottom: 16, border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: "#36b7ff", marginBottom: 12 }}>
              Destination & Pricing
            </div>
            <FormRow cols={2}>
              <FormField label="Destination Island" htmlFor="destination" required>
                <input
                  id="destination"
                  type="text"
                  list="island-datalist"
                  value={form.destination}
                  onChange={(e) => set("destination", e.target.value)}
                  placeholder="Start typing or pick an island…"
                />
                <datalist id="island-datalist">
                  {ISLANDS.map((i) => (
                    <option key={i} value={i} />
                  ))}
                </datalist>
              </FormField>
              <FormField label="Price" htmlFor="transfer_price_cents" required>
                <input
                  id="transfer_price_cents"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.transfer_price_cents}
                  onChange={(e) => set("transfer_price_cents", e.target.value)}
                  placeholder="0"
                />
              </FormField>
            </FormRow>
            <FormRow cols={2}>
              <FormField label="Currency" htmlFor="transfer_currency">
                <select id="transfer_currency" value={form.transfer_currency} onChange={(e) => set("transfer_currency", e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="MVR">MVR</option>
                </select>
              </FormField>
              <FormField label="Seats Open" htmlFor="seats_open" hint="Set lower than capacity to hold walk-in / partner seats.">
                <input id="seats_open" type="number" min="0" value={form.seats_open} onChange={(e) => set("seats_open", e.target.value)} />
              </FormField>
            </FormRow>
          </div>
        )}

        {!isHire && (
          <FormRow cols={2}>
            <FormField label="Guide / Crew" htmlFor="guide_id">
              <select id="guide_id" value={form.guide_id} onChange={(e) => set("guide_id", e.target.value)}>
                <option value="">No guide</option>
                {crew.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}{c.sub ? ` · ${c.sub}` : ""}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Captain" htmlFor="captain_id">
              <select id="captain_id" value={form.captain_id} onChange={(e) => set("captain_id", e.target.value)}>
                <option value="">No captain</option>
                {crew.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}{c.sub ? ` · ${c.sub}` : ""}</option>
                ))}
              </select>
            </FormField>
          </FormRow>
        )}

        <FormRow cols={2}>
          <FormField label="Start Time" htmlFor="start_time">
            <input id="start_time" type="time" value={form.start_time} onChange={(e) => set("start_time", e.target.value)} />
          </FormField>
          <FormField label="End Time (approx)" htmlFor="end_time">
            <input id="end_time" type="time" value={form.end_time} onChange={(e) => set("end_time", e.target.value)} />
          </FormField>
        </FormRow>

        {!isHire && !trip && (
          <FormField label="Initial Status" htmlFor="status">
            <select id="status" value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option value="planned">Planned</option>
              <option value="ready">Ready (departing soon)</option>
            </select>
          </FormField>
        )}

        <FormField label="Notes" htmlFor="notes">
          <textarea id="notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </FormField>
      </form>
    </AdminModal>
  );
}