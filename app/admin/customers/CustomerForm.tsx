"use client";

import { useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { createCustomer, updateCustomer } from "@/lib/supabase/actions";

interface CustomerFormProps {
  open: boolean;
  onClose: () => void;
  customer?: Record<string, unknown>;
  onSaved: () => void;
}

export default function CustomerForm({ open, onClose, customer, onSaved }: CustomerFormProps) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({
    full_name: (customer?.full_name as string) || "",
    email: (customer?.email as string) || "",
    phone: (customer?.phone as string) || "",
    nationality: (customer?.nationality as string) || "",
    passport_number: (customer?.passport_number as string) || "",
    date_of_birth: (customer?.date_of_birth as string) || "",
    hotel: (customer?.hotel as string) || "",
    room_number: (customer?.room_number as string) || "",
    emergency_contact_name: (customer?.emergency_contact_name as string) || "",
    emergency_contact_phone: (customer?.emergency_contact_phone as string) || "",
    medical_conditions: (customer?.medical_conditions as string) || "",
    allergies: (customer?.allergies as string) || "",
    medications: (customer?.medications as string) || "",
    notes: (customer?.notes as string) || "",
  });

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) {
      setToast({ type: "error", message: "Full name is required." });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) {
      setToast({ type: "error", message: "A valid email is required." });
      return;
    }
    startTransition(async () => {
      try {
        if (customer?.id) {
          await updateCustomer(customer.id as string, form);
        } else {
          await createCustomer(form);
        }
        onSaved();
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save customer." });
      }
    });
  }

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={customer?.id ? "Edit Customer" : "New Customer"}
      wide
      footer={
        <>
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" form="customer-form" className="formSubmit" disabled={pending}>
            {pending ? "Saving..." : customer?.id ? "Update Customer" : "Create Customer"}
          </button>
        </>
      }
    >
      {toast && <Toast type={toast.type} message={toast.message} />}
      <form id="customer-form" onSubmit={handleSubmit}>
        <FormRow cols={2}>
          <FormField label="Full Name" htmlFor="full_name" required>
            <input id="full_name" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </FormField>
          <FormField label="Email" htmlFor="email" required>
            <input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
          </FormField>
        </FormRow>
        <FormRow cols={3}>
          <FormField label="Phone" htmlFor="phone">
            <input id="phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </FormField>
          <FormField label="Nationality" htmlFor="nationality">
            <input id="nationality" value={form.nationality} onChange={(e) => set("nationality", e.target.value)} />
          </FormField>
          <FormField label="Passport #" htmlFor="passport_number">
            <input id="passport_number" value={form.passport_number} onChange={(e) => set("passport_number", e.target.value)} />
          </FormField>
        </FormRow>
        <FormRow cols={3}>
          <FormField label="Date of Birth" htmlFor="date_of_birth">
            <input id="date_of_birth" type="date" value={form.date_of_birth} onChange={(e) => set("date_of_birth", e.target.value)} />
          </FormField>
          <FormField label="Hotel" htmlFor="hotel">
            <input id="hotel" value={form.hotel} onChange={(e) => set("hotel", e.target.value)} />
          </FormField>
          <FormField label="Room #" htmlFor="room_number">
            <input id="room_number" value={form.room_number} onChange={(e) => set("room_number", e.target.value)} />
          </FormField>
        </FormRow>
        <FormRow cols={2}>
          <FormField label="Emergency Contact Name" htmlFor="emergency_contact_name">
            <input id="emergency_contact_name" value={form.emergency_contact_name} onChange={(e) => set("emergency_contact_name", e.target.value)} />
          </FormField>
          <FormField label="Emergency Contact Phone" htmlFor="emergency_contact_phone">
            <input id="emergency_contact_phone" value={form.emergency_contact_phone} onChange={(e) => set("emergency_contact_phone", e.target.value)} />
          </FormField>
        </FormRow>
        <FormRow cols={2}>
          <FormField label="Medical Conditions" htmlFor="medical_conditions">
            <textarea id="medical_conditions" value={form.medical_conditions} onChange={(e) => set("medical_conditions", e.target.value)} />
          </FormField>
          <FormField label="Allergies" htmlFor="allergies">
            <textarea id="allergies" value={form.allergies} onChange={(e) => set("allergies", e.target.value)} />
          </FormField>
        </FormRow>
        <FormRow cols={2}>
          <FormField label="Medications" htmlFor="medications">
            <textarea id="medications" value={form.medications} onChange={(e) => set("medications", e.target.value)} />
          </FormField>
          <FormField label="Notes" htmlFor="notes">
            <textarea id="notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </FormField>
        </FormRow>

      </form>
    </AdminModal>
  );
}
