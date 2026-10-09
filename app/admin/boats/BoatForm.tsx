"use client";

import { useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { createBoat, updateBoat } from "@/lib/supabase/actions";

interface BoatFormProps {
  open: boolean;
  onClose: () => void;
  boat?: Record<string, unknown>;
  onSaved: (msg: string) => void;
}

const TYPES = ["speedboat", "dhoni", "rib", "jet_ski", "kayak", "sup", "boat", "other"];

export default function BoatForm({ open, onClose, boat, onSaved }: BoatFormProps) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({
    name: (boat?.name as string) || "",
    boat_type: (boat?.boat_type as string) || "speedboat",
    capacity_pax: String(boat?.capacity_pax ?? ""),
    status: (boat?.status as string) || "active",
    notes: (boat?.notes as string) || "",
  });

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setToast({ type: "error", message: "Boat name is required." });
      return;
    }
    const cap = Number(form.capacity_pax);
    if (!Number.isFinite(cap) || cap < 1) {
      setToast({ type: "error", message: "Capacity must be at least 1 pax." });
      return;
    }
    startTransition(async () => {
      try {
        const payload = {
          name: form.name,
          boat_type: form.boat_type,
          capacity_pax: cap,
          status: form.status,
          notes: form.notes || null,
        };
        if (boat?.id) {
          await updateBoat(boat.id as string, payload);
          onSaved("Craft updated.");
        } else {
          await createBoat(payload);
          onSaved("Craft added to the fleet.");
        }
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save craft." });
      }
    });
  }

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={boat?.id ? "Edit Craft" : "Add Craft"}
      wide
      footer={
        <>
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" form="boat-form" className="formSubmit" disabled={pending}>
            {pending ? "Saving..." : boat?.id ? "Update Craft" : "Add Craft"}
          </button>
        </>
      }
    >
      {toast && <Toast type={toast.type} message={toast.message} />}
      <form id="boat-form" onSubmit={handleSubmit}>
        <FormRow cols={2}>
          <FormField label="Name" htmlFor="boat_name" required>
            <input id="boat_name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Thoddoo Marine Speedboat" />
          </FormField>
          <FormField label="Type" htmlFor="boat_type">
            <select id="boat_type" value={form.boat_type} onChange={(e) => set("boat_type", e.target.value)}>
              {TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
            </select>
          </FormField>
        </FormRow>
        <FormRow cols={2}>
          <FormField label="Capacity (pax)" htmlFor="capacity_pax" required>
            <input id="capacity_pax" type="number" min="1" value={form.capacity_pax} onChange={(e) => set("capacity_pax", e.target.value)} />
          </FormField>
          <FormField label="Status" htmlFor="boat_status" hint="Maintenance crafts can't be put on trips.">
            <select id="boat_status" value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option value="active">Active</option>
              <option value="maintenance">Maintenance</option>
              <option value="training">Training</option>
            </select>
          </FormField>
        </FormRow>
        <FormField label="Notes" htmlFor="boat_notes">
          <textarea id="boat_notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </FormField>
      </form>
    </AdminModal>
  );
}