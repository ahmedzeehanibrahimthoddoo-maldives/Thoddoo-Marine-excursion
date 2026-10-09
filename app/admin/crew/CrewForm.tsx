"use client";

import { useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { createCrewMember, updateCrewMember } from "@/lib/supabase/actions";

interface CrewFormProps {
  open: boolean;
  onClose: () => void;
  member?: Record<string, unknown>;
  staffProfiles?: { id: string; full_name: string; role: string }[];
  onSaved: (msg: string) => void;
}

const ROLES = [
  "Dive Instructor",
  "Boat Captain",
  "Snorkel Guide",
  "Jet Ski Operator",
  "Towing Operator",
  "Deck Hand",
  "Engineer",
  "Reception / Crew",
];

export default function CrewForm({ open, onClose, member, staffProfiles = [], onSaved }: CrewFormProps) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({
    full_name: (member?.full_name as string) || "",
    role: (member?.role as string) || "",
    phone: (member?.phone as string) || "",
    active: member?.active !== false,
    notes: (member?.notes as string) || "",
    staff_profile_id: (member?.staff_profile_id as string) || "",
  });

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) {
      setToast({ type: "error", message: "Name is required." });
      return;
    }
    if (!form.role.trim()) {
      setToast({ type: "error", message: "Role is required." });
      return;
    }
    startTransition(async () => {
      try {
        const payload = {
          full_name: form.full_name,
          role: form.role,
          phone: form.phone || null,
          active: form.active,
          notes: form.notes || null,
          staff_profile_id: form.staff_profile_id || null,
        };
        if (member?.id) {
          await updateCrewMember(member.id as string, payload);
          onSaved("Crew member updated.");
        } else {
          await createCrewMember(payload);
          onSaved("Crew member added.");
        }
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save crew member." });
      }
    });
  }

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={member?.id ? "Edit Crew Member" : "New Crew Member"}
      wide
      footer={
        <>
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" form="crew-form" className="formSubmit" disabled={pending}>
            {pending ? "Saving..." : member?.id ? "Update" : "Add Crew Member"}
          </button>
        </>
      }
    >
      {toast && <Toast type={toast.type} message={toast.message} />}
      <form id="crew-form" onSubmit={handleSubmit}>
        <FormRow cols={2}>
          <FormField label="Full Name" htmlFor="crew_name" required>
            <input id="crew_name" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </FormField>
          <FormField label="Role" htmlFor="crew_role" required>
            <select id="crew_role" value={form.role} onChange={(e) => set("role", e.target.value)}>
              <option value="">Select role…</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </FormField>
        </FormRow>
        <FormField label="Phone / WhatsApp" htmlFor="crew_phone">
          <input id="crew_phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+960 …" />
        </FormField>
        <FormField label="Linked Staff Login (receives tasks)" htmlFor="crew_staff">
          <select id="crew_staff" value={form.staff_profile_id} onChange={(e) => set("staff_profile_id", e.target.value)}>
            <option value="">No login</option>
            {staffProfiles.map((s) => (
              <option key={s.id} value={s.id}>{s.full_name}{s.role ? ` · ${s.role}` : ""}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Notes" htmlFor="crew_notes">
          <textarea id="crew_notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </FormField>
        <FormField label="Active" htmlFor="crew_active">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id="crew_active"
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Available for trip scheduling</span>
          </label>
        </FormField>
      </form>
    </AdminModal>
  );
}