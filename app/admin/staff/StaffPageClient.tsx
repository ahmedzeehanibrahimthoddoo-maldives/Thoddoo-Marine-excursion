"use client";

import { useState, useTransition } from "react";
import { updateStaffProfile } from "@/lib/supabase/actions";
import { fmtDate } from "@/lib/format";
import StaffForm from "./StaffForm";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  reception: "Reception",
  watersports_staff: "Watersports Staff",
  boat_crew: "Boat Crew",
};

interface StaffPageClientProps {
  staff: Record<string, unknown>[];
  currentUserId?: string | null;
}

export default function StaffPageClient({ staff, currentUserId }: StaffPageClientProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Record<string, unknown> | undefined>(undefined);
  const [isPending, startTransition] = useTransition();

  const refresh = () => {
    startTransition(() => {
      window.location.reload();
    });
  };

  const toggleActive = async (id: string, currentActive: boolean) => {
    if (currentActive) {
      const ok = window.confirm(
        "Deactivating this account instantly removes their access to all staff data (bookings, trips, rentals, payments...). Continue?"
      );
      if (!ok) return;
    }
    try {
      await updateStaffProfile(id, { active: !currentActive });
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update staff status");
    }
  };

  return (
    <>
      <div className="adminPageHeader" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1>Staff</h1>
          <p className="adminPageSub">{staff.length} team members</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditingStaff(undefined); setFormOpen(true); }}>
          + Add Staff
        </button>
      </div>

      {staff.length > 0 ? (
        <div className="tableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Joined</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id as string}>
                  <td><strong>{s.full_name as string}</strong></td>
                  <td><span className="badge badge-role">{ROLE_LABELS[s.role as string] || s.role as string}</span></td>
                  <td>{(s.phone as string) || "—"}</td>
                  <td>
                    {s.active
                      ? <span className="badge badge-confirmed">Active</span>
                      : <span className="badge badge-cancelled">Inactive</span>}
                  </td>
                  <td>{fmtDate(s.created_at as string)}</td>
                  <td style={{ textAlign: "right" }}>
                    <div className="inlineActions" style={{ justifyContent: "flex-end" }}>
                      <button
                        className="actionBtn"
                        onClick={() => { setEditingStaff(s); setFormOpen(true); }}
                        disabled={isPending}
                        title="Edit staff"
                      >
                        ✎
                      </button>
                      <button
                        className={`actionBtn ${s.active ? "actionBtn-cancelled" : "actionBtn-confirmed"}`}
                        onClick={() => toggleActive(s.id as string, Boolean(s.active))}
                        disabled={isPending || s.user_id === currentUserId}
                        title={
                          s.user_id === currentUserId
                            ? "You cannot deactivate your own account"
                            : s.active
                              ? "Deactivate"
                              : "Activate"
                        }
                      >
                        {s.active ? "◯" : "●"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="emptyState">
          <p>No staff profiles found. Create staff accounts in the Supabase Auth dashboard and assign profiles here.</p>
        </div>
      )}

      <StaffForm
        key={editingStaff ? String(editingStaff.id) : "new"}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        staff={editingStaff}
        onSaved={refresh}
      />
    </>
  );
}
