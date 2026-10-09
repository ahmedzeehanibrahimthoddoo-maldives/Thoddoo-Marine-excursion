"use client";

import { useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { createStaffProfile, createStaffLogin, updateStaffProfile } from "@/lib/supabase/actions";

interface StaffFormProps {
  open: boolean;
  onClose: () => void;
  staff?: Record<string, unknown>;
  onSaved: () => void;
}

export default function StaffForm({ open, onClose, staff, onSaved }: StaffFormProps) {
  const [createLogin, setCreateLogin] = useState(false);
  const [userId, setUserId] = useState((staff?.user_id as string) || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState((staff?.full_name as string) || "");
  const [role, setRole] = useState((staff?.role as string) || "reception");
  const [phone, setPhone] = useState((staff?.phone as string) || "");
  const [active, setActive] = useState(staff ? Boolean(staff.active) : true);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const isEdit = Boolean(staff);

  const handleSubmit = () => {
    if (!isEdit && createLogin) {
      if (!email.trim()) {
        setToast({ type: "error", message: "Email is required" });
        return;
      }
      if (!fullName.trim()) {
        setToast({ type: "error", message: "Full name is required" });
        return;
      }
    }
    if (!isEdit && !createLogin && !userId.trim()) {
      setToast({ type: "error", message: "User ID is required" });
      return;
    }
    if (!fullName.trim()) {
      setToast({ type: "error", message: "Full name is required" });
      return;
    }

    startTransition(async () => {
      try {
        if (isEdit && staff) {
          await updateStaffProfile(staff.id as string, {
            full_name: fullName.trim(),
            role,
            phone: phone.trim() || undefined,
            active,
          });
        } else if (createLogin) {
          await createStaffLogin({
            email: email.trim(),
            password,
            full_name: fullName.trim(),
            role,
            phone: phone.trim() || undefined,
          });
        } else {
          await createStaffProfile({
            user_id: userId.trim(),
            full_name: fullName.trim(),
            role,
            phone: phone.trim() || undefined,
          });
        }
        setToast({ type: "success", message: isEdit ? "Staff updated" : (createLogin ? "Login created" : "Staff created") });
        setTimeout(() => {
          onSaved();
          onClose();
        }, 600);
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save" });
      }
    });
  };

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit Staff" : "Add Staff"}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving..." : isEdit ? "Update" : "Create"}
          </button>
        </>
      }
    >
      {!isEdit && (
        <FormField label="Account type" htmlFor="staff_create_mode">
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            <input
              id="staff_create_mode"
              type="checkbox"
              checked={createLogin}
              onChange={(e) => setCreateLogin(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            Create a new login (email + password) for this staff member
          </label>
        </FormField>
      )}

      <FormRow>
        {(!isEdit && createLogin) && (
          <FormField label="Email" htmlFor="staff_email" required>
            <input
              id="staff_email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@thoddoomarine.mv"
            />
          </FormField>
        )}
        {(!isEdit && !createLogin) && (
          <FormField label="Auth User ID" htmlFor="staff_user_id" required>
            <input
              id="staff_user_id"
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Supabase Auth UUID"
            />
          </FormField>
        )}
        <FormField label="Full Name" htmlFor="staff_full_name" required>
          <input
            id="staff_full_name"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name"
          />
        </FormField>
      </FormRow>
      {!isEdit && createLogin && (
        <FormRow cols={2}>
          <FormField label="Password" htmlFor="staff_password" required hint="Min 8 characters — share it securely with the staff member.">
            <input
              id="staff_password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Set the initial password"
            />
          </FormField>
        </FormRow>
      )}
      <FormRow cols={2}>
        <FormField label="Role" htmlFor="staff_role">
          <select id="staff_role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="owner">Owner</option>
            <option value="manager">Manager</option>
            <option value="reception">Reception</option>
            <option value="watersports_staff">Watersports Staff</option>
            <option value="boat_crew">Boat Crew</option>
          </select>
        </FormField>
        <FormField label="Phone" htmlFor="staff_phone">
          <input
            id="staff_phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone number"
          />
        </FormField>
      </FormRow>
      {isEdit && (
        <FormField label="Active" htmlFor="staff_active">
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            <input
              id="staff_active"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            Account is active
          </label>
        </FormField>
      )}
      {toast && <Toast type={toast.type} message={toast.message} />}
    </AdminModal>
  );
}