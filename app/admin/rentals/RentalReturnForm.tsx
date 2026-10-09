"use client";

import { useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { returnEquipment } from "@/lib/supabase/actions";
import { formatMoney, toMajorInput, parseMajorInput, validCurrency } from "@/lib/money";

interface RentalReturnFormProps {
  open: boolean;
  onClose: () => void;
  rental: Record<string, unknown>;
  onSaved: () => void;
}

export default function RentalReturnForm({ open, onClose, rental, onSaved }: RentalReturnFormProps) {
  const [returnCondition, setReturnCondition] = useState("good");
  const [damageNotes, setDamageNotes] = useState("");
  const [additionalChargesCents, setAdditionalChargesCents] = useState("");
  const [returnPhotoUrl, setReturnPhotoUrl] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const equipmentName = ((rental?.equipment as Record<string, unknown>)?.name as string) || "Equipment";
  const customerName = ((rental?.customers as Record<string, unknown>)?.full_name as string) || "Customer";

  const rawConsent = rental?.consent_forms as
    | Record<string, unknown>
    | Record<string, unknown>[]
    | null
    | undefined;
  const consentRow = Array.isArray(rawConsent) ? rawConsent[0] : rawConsent;
  const consentStatus = (consentRow?.status as string) || null;
  const guestSigned = consentStatus === "signed";

  const handleSubmit = () => {
    startTransition(async () => {
      try {
        await returnEquipment(rental.id as string, {
          return_condition: returnCondition,
          damage_notes: damageNotes.trim() || undefined,
          additional_charges_cents: additionalChargesCents ? parseMajorInput(additionalChargesCents) : undefined,
        });
        setToast({ type: "success", message: "Equipment returned" });
        setTimeout(() => {
          onSaved();
          onClose();
        }, 600);
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Return failed" });
      }
    });
  };

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={`Return: ${equipmentName}`}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Processing..." : "Confirm Return"}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 13, color: "#647993", marginBottom: 16 }}>
        Returning equipment for <strong>{customerName}</strong>
      </p>
      {guestSigned ? (
        <div style={{ background: "#d4edda", color: "#155724", borderRadius: 8, padding: "8px 10px", fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
          ✓ Guest consent &amp; liability form signed.
        </div>
      ) : (
        <div style={{ background: "#fff3cd", color: "#856404", borderRadius: 8, padding: "8px 10px", fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
          ⚠ Consent form not signed yet — the return is blocked until the guest signs the liability form.
        </div>
      )}
      <FormRow cols={2}>
        <FormField label="Return Condition" htmlFor="ret_condition" required>
          <select id="ret_condition" value={returnCondition} onChange={(e) => setReturnCondition(e.target.value)}>
            <option value="excellent">Excellent</option>
            <option value="good">Good</option>
            <option value="fair">Fair</option>
            <option value="poor">Poor</option>
            <option value="damaged">Damaged</option>
          </select>
        </FormField>
        <FormField label="Additional Charges" htmlFor="ret_charges">
          <input
            id="ret_charges"
            type="number"
            value={additionalChargesCents}
            onChange={(e) => setAdditionalChargesCents(e.target.value)}
            placeholder="0"
          />
        </FormField>
      </FormRow>
      <FormField label="Damage Notes" htmlFor="ret_notes">
        <textarea
          id="ret_notes"
          rows={3}
          value={damageNotes}
          onChange={(e) => setDamageNotes(e.target.value)}
          placeholder="Describe any damage or issues..."
        />
      </FormField>
      <FormField label="Return Photo URL" htmlFor="ret_photo" hint="Placeholder for future photo upload">
        <input
          id="ret_photo"
          type="text"
          value={returnPhotoUrl}
          onChange={(e) => setReturnPhotoUrl(e.target.value)}
          placeholder="https://..."
        />
      </FormField>
      {toast && <Toast type={toast.type} message={toast.message} />}
    </AdminModal>
  );
}
