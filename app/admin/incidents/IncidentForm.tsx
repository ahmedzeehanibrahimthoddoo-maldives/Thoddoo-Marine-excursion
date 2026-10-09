"use client";

import { useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { createIncident, updateIncident } from "@/lib/supabase/actions";

interface IncidentFormProps {
  open: boolean;
  onClose: () => void;
  incident?: Record<string, unknown>;
  onSaved: () => void;
}

export default function IncidentForm({ open, onClose, incident, onSaved }: IncidentFormProps) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({
    incident_date: (incident?.incident_date as string)?.slice(0, 16) || "",
    severity: (incident?.severity as string) || "minor",
    reported_by: (incident?.reported_by as string) || "",
    description: (incident?.description as string) || "",
    actions_taken: (incident?.actions_taken as string) || "",
    equipment_involved: (incident?.equipment_involved as string) || "",
    vessel_ref: (incident?.vessel_ref as string) || "",
    witness_names: (incident?.witness_names as string) || "",
    alarm_warning_seen: (incident?.alarm_warning_seen as boolean) || false,
    alarm_notes: (incident?.alarm_notes as string) || "",
    mechanical_damage: (incident?.mechanical_damage as string) || "",
    evidence_notes: (incident?.evidence_notes as string) || "",
    photos_text: ((incident?.photos as { url?: string; note?: string }[] | undefined) || [])
      .map((p) => [p.url, p.note].filter(Boolean).join(" | "))
      .join("\n"),
    follow_up_needed: (incident?.follow_up_needed as boolean) || false,
    follow_up_notes: (incident?.follow_up_notes as string) || "",
    resolved: (incident?.resolved as boolean) || false,
  });

  function set(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.incident_date) {
      setToast({ type: "error", message: "Incident date is required." });
      return;
    }
    if (!form.severity) {
      setToast({ type: "error", message: "Severity is required." });
      return;
    }
    if (!form.reported_by.trim()) {
      setToast({ type: "error", message: "Reported by is required." });
      return;
    }
    if (!form.description.trim()) {
      setToast({ type: "error", message: "Description is required." });
      return;
    }
    startTransition(async () => {
      try {
        const payload = {
          incident_date: form.incident_date,
          severity: form.severity,
          reported_by: form.reported_by,
          description: form.description,
          actions_taken: form.actions_taken || null,
          equipment_involved: form.equipment_involved || null,
          vessel_ref: form.vessel_ref || null,
          witness_names: form.witness_names || null,
          alarm_warning_seen: form.alarm_warning_seen,
          alarm_notes: form.alarm_notes || null,
          mechanical_damage: form.mechanical_damage || null,
          evidence_notes: form.evidence_notes || null,
          photos: form.photos_text
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const [note, ...rest] = line.split("|").map((s) => s.trim());
              const url = rest.join("|").trim() || note;
              return { url, note: rest.length > 0 ? note : "" };
            }),
          follow_up_needed: form.follow_up_needed,
          follow_up_notes: form.follow_up_notes || null,
          resolved: form.resolved,
        };
        if (incident?.id) {
          await updateIncident(incident.id as string, payload);
        } else {
          await createIncident(payload);
        }
        onSaved();
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save incident." });
      }
    });
  }

  return (
    <AdminModal open={open} onClose={onClose} title={incident?.id ? "Edit Incident" : "Report Incident"} wide>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <form onSubmit={handleSubmit}>
        <FormRow cols={2}>
          <FormField label="Incident Date" htmlFor="incident_date" required>
            <input id="incident_date" type="datetime-local" value={form.incident_date} onChange={(e) => set("incident_date", e.target.value)} />
          </FormField>
          <FormField label="Severity" htmlFor="severity" required>
            <select id="severity" value={form.severity} onChange={(e) => set("severity", e.target.value)}>
              <option value="minor">Minor</option>
              <option value="moderate">Moderate</option>
              <option value="major">Major</option>
              <option value="critical">Critical</option>
            </select>
          </FormField>
        </FormRow>
        <FormField label="Reported By" htmlFor="reported_by" required>
          <input id="reported_by" value={form.reported_by} onChange={(e) => set("reported_by", e.target.value)} />
        </FormField>
        <FormField label="Description" htmlFor="description" required>
          <textarea id="description" value={form.description} onChange={(e) => set("description", e.target.value)} />
        </FormField>
        <FormField label="Actions Taken" htmlFor="actions_taken">
          <textarea id="actions_taken" value={form.actions_taken} onChange={(e) => set("actions_taken", e.target.value)} />
        </FormField>
        <FormRow cols={2}>
          <FormField label="Equipment Involved" htmlFor="equipment_involved">
            <input id="equipment_involved" value={form.equipment_involved} onChange={(e) => set("equipment_involved", e.target.value)} />
          </FormField>
          <FormField label="Vessel / Craft Ref" htmlFor="vessel_ref">
            <input id="vessel_ref" value={form.vessel_ref} onChange={(e) => set("vessel_ref", e.target.value)} />
          </FormField>
        </FormRow>
        <FormField label="Warning Alarm Seen" htmlFor="alarm_warning_seen">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id="alarm_warning_seen"
              type="checkbox"
              checked={form.alarm_warning_seen}
              onChange={(e) => set("alarm_warning_seen", e.target.checked)}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Machine warning was active before/during the incident</span>
          </label>
        </FormField>
        {form.alarm_warning_seen && (
          <FormField label="Alarm Details" htmlFor="alarm_notes">
            <textarea id="alarm_notes" value={form.alarm_notes} onChange={(e) => set("alarm_notes", e.target.value)} />
          </FormField>
        )}
        <FormField label="Mechanical Damage" htmlFor="mechanical_damage">
          <textarea id="mechanical_damage" value={form.mechanical_damage} onChange={(e) => set("mechanical_damage", e.target.value)} />
        </FormField>
        <FormField label="Evidence Notes" htmlFor="evidence_notes">
          <textarea id="evidence_notes" value={form.evidence_notes} onChange={(e) => set("evidence_notes", e.target.value)} />
        </FormField>
        <FormField label="Photos" htmlFor="photos_text">
          <textarea
            id="photos_text"
            rows={2}
            placeholder={"One per line: note | url  (or just url)"}
            value={form.photos_text}
            onChange={(e) => set("photos_text", e.target.value)}
          />
        </FormField>
        <FormRow cols={2}>
          <FormField label="Witness Names" htmlFor="witness_names">
            <input id="witness_names" value={form.witness_names} onChange={(e) => set("witness_names", e.target.value)} />
          </FormField>
        </FormRow>
        <FormField label="Follow-up Needed" htmlFor="follow_up_needed">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id="follow_up_needed"
              type="checkbox"
              checked={form.follow_up_needed}
              onChange={(e) => set("follow_up_needed", e.target.checked)}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Requires follow-up</span>
          </label>
        </FormField>
        {form.follow_up_needed && (
          <FormField label="Follow-up Notes" htmlFor="follow_up_notes">
            <textarea id="follow_up_notes" value={form.follow_up_notes} onChange={(e) => set("follow_up_notes", e.target.value)} />
          </FormField>
        )}
        {incident?.id ? (
          <FormField label="Resolved" htmlFor="resolved">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                id="resolved"
                type="checkbox"
                checked={form.resolved}
                onChange={(e) => set("resolved", e.target.checked)}
              />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Mark as resolved</span>
            </label>
          </FormField>
        ) : null}
        <div className="formActions">
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" className="formSubmit" disabled={pending}>
            {pending ? "Saving..." : incident?.id ? "Update Incident" : "Report Incident"}
          </button>
        </div>
      </form>
    </AdminModal>
  );
}
