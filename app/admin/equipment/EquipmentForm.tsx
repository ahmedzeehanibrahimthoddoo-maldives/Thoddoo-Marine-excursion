"use client";

import { useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { createEquipment, updateEquipment } from "@/lib/supabase/actions";
import { formatMoney, toMajorInput, parseMajorInput, validCurrency } from "@/lib/money";

interface EquipmentFormProps {
  open: boolean;
  onClose: () => void;
  equipment?: Record<string, unknown>;
  onSaved: () => void;
}

export default function EquipmentForm({ open, onClose, equipment, onSaved }: EquipmentFormProps) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({
    name: (equipment?.name as string) || "",
    asset_number: (equipment?.asset_number as string) || "",
    category: (equipment?.category as string) || "",
    description: (equipment?.description as string) || "",
    condition_status: (equipment?.condition_status as string) || "good",
    daily_rate_cents: toMajorInput(Number(equipment?.daily_rate_cents ?? 0)),
    deposit_cents: toMajorInput(Number(equipment?.deposit_cents ?? 0)),
    active: equipment?.active !== false,
  });
  const [currency, setCurrency] = useState(validCurrency(equipment?.currency));

  function set(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setToast({ type: "error", message: "Name is required." });
      return;
    }
    if (!form.asset_number.trim()) {
      setToast({ type: "error", message: "Asset number is required." });
      return;
    }
    if (!form.category.trim()) {
      setToast({ type: "error", message: "Category is required." });
      return;
    }
    startTransition(async () => {
      try {
        const payload = {
          name: form.name,
          asset_number: form.asset_number,
          category: form.category,
          description: form.description || null,
          condition_status: form.condition_status,
          daily_rate_cents: parseMajorInput(form.daily_rate_cents),
          deposit_cents: parseMajorInput(form.deposit_cents),
          currency,
          active: form.active,
        };
        if (equipment?.id) {
          await updateEquipment(equipment.id as string, payload);
        } else {
          await createEquipment(payload);
        }
        onSaved();
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save equipment." });
      }
    });
  }

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={equipment?.id ? "Edit Equipment" : "New Equipment"}
      wide
      footer={
        <>
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" form="equipment-form" className="formSubmit" disabled={pending}>
            {pending ? "Saving..." : equipment?.id ? "Update Equipment" : "Create Equipment"}
          </button>
        </>
      }
    >
      {toast && <Toast type={toast.type} message={toast.message} />}
      <form id="equipment-form" onSubmit={handleSubmit}>
        <FormRow cols={2}>
          <FormField label="Name" htmlFor="name" required>
            <input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </FormField>
          <FormField label="Asset #" htmlFor="asset_number" required>
            <input id="asset_number" value={form.asset_number} onChange={(e) => set("asset_number", e.target.value)} />
          </FormField>
        </FormRow>
        <FormRow cols={2}>
          <FormField label="Category" htmlFor="category" required>
            <input id="category" value={form.category} onChange={(e) => set("category", e.target.value)} />
          </FormField>
          <FormField label="Condition" htmlFor="condition_status">
            <select id="condition_status" value={form.condition_status} onChange={(e) => set("condition_status", e.target.value)}>
              <option value="excellent">Excellent</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="poor">Poor</option>
              <option value="damaged">Damaged</option>
            </select>
          </FormField>
        </FormRow>
        <FormField label="Description" htmlFor="description">
          <textarea id="description" value={form.description} onChange={(e) => set("description", e.target.value)} />
        </FormField>
        <FormRow cols={3}>
          <FormField label="Daily Rate" htmlFor="daily_rate_cents">
            <input id="daily_rate_cents" type="number" step="0.01" min="0" value={form.daily_rate_cents} onChange={(e) => set("daily_rate_cents", e.target.value)} />
          </FormField>
          <FormField label="Deposit" htmlFor="deposit_cents">
            <input id="deposit_cents" type="number" step="0.01" min="0" value={form.deposit_cents} onChange={(e) => set("deposit_cents", e.target.value)} />
          </FormField>
          <FormField label="Currency" htmlFor="eq_currency">
            <select id="eq_currency" value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "MVR")}>
              <option value="USD">USD</option>
              <option value="MVR">MVR</option>
            </select>
          </FormField>
        </FormRow>
        <FormField label="Active" htmlFor="active">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id="active"
              type="checkbox"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Available for rental</span>
          </label>
        </FormField>
      </form>
    </AdminModal>
  );
}
