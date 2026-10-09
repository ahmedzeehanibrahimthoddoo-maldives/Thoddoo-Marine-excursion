"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCrewMember, updateCrewMember, deleteCrewMember } from "@/lib/supabase/actions";
import CrewForm from "./CrewForm";
import { Toast } from "@/app/admin/components/AdminModal";

interface Props {
  initialCrew: Record<string, unknown>[];
  staffProfiles: { id: string; full_name: string; role: string }[];
}

export default function CrewPageClient({ initialCrew, staffProfiles }: Props) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Record<string, unknown> | undefined>(undefined);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function flash(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }

  function refresh(msg: string) {
    router.refresh();
    setFormOpen(false);
    setEditingMember(undefined);
    flash("success", msg);
  }

  async function handleDelete(c: Record<string, unknown>) {
    if (!confirm(`Delete ${String(c.full_name)}? Crew assigned to trips cannot be deleted.`)) return;
    setBusy(true);
    try {
      await deleteCrewMember(String(c.id));
      refresh(`${String(c.full_name)} removed from the roster.`);
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Failed to delete crew member");
      setBusy(false);
    }
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <div className="pageActions" style={{ marginBottom: 16 }}>
        <button className="addBtn" onClick={() => { setEditingMember(undefined); setFormOpen(true); }}>
          + Add Crew Member
        </button>
      </div>
      {initialCrew.length > 0 ? (
        <div className="tableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Phone</th>
                <th>Login</th>
                <th>Active</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialCrew.map((c) => (
                <tr key={String(c.id)} className={c.active === false ? "rowMuted" : undefined}>
                  <td><strong>{String(c.full_name)}</strong></td>
                  <td><span className="badge badge-role">{String(c.role)}</span></td>
                  <td className="mono">{String(c.phone || "—")}</td>
                  <td>{String(c.staff_profile_id ? (staffProfiles.find((s) => s.id === c.staff_profile_id)?.full_name || "Linked") : "—")}</td>
                  <td>{c.active === false ? "—" : "✓"}</td>
                  <td className="textMuted">{String(c.notes || "—")}</td>
                  <td>
                    <div className="inlineActions">
                      <button className="actionBtn" disabled={busy} onClick={() => { setEditingMember(c); setFormOpen(true); }} title="Edit">✎</button>
                      <button className="actionBtn danger" disabled={busy} onClick={() => handleDelete(c)} title="Delete">🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="emptyState">
          <p>No crew on the roster. Add guides, captains and operators who run the trips.</p>
        </div>
      )}
      <CrewForm
        key={editingMember ? String(editingMember.id) : "new"}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingMember(undefined); }}
        member={editingMember}
        staffProfiles={staffProfiles}
        onSaved={(msg) => refresh(msg)}
      />
    </>
  );
}