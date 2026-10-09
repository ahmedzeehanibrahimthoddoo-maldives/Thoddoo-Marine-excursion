"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BOAT_STATUS_LABEL } from "@/lib/operations";
import { createBoat, updateBoat, deleteBoat } from "@/lib/supabase/actions";
import BoatForm from "./BoatForm";
import { Toast } from "@/app/admin/components/AdminModal";

interface Props {
  initialBoats: Record<string, unknown>[];
}

export default function BoatsPageClient({ initialBoats }: Props) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editingBoat, setEditingBoat] = useState<Record<string, unknown> | undefined>(undefined);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function flash(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }

  function refresh(msg: string) {
    router.refresh();
    setFormOpen(false);
    setEditingBoat(undefined);
    flash("success", msg);
  }

  async function handleDelete(b: Record<string, unknown>) {
    if (!confirm(`Delete ${String(b.name)}? Boats with trips cannot be deleted.`)) return;
    setBusy(true);
    try {
      await deleteBoat(String(b.id));
      refresh(`${String(b.name)} deleted.`);
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Failed to delete boat");
      setBusy(false);
    }
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <div className="pageActions" style={{ marginBottom: 16 }}>
        <button className="addBtn" onClick={() => { setEditingBoat(undefined); setFormOpen(true); }}>
          + Add Boat / Craft
        </button>
      </div>
      {initialBoats.length > 0 ? (
        <div className="tableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Capacity</th>
                <th>Status</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialBoats.map((b) => (
                <tr key={String(b.id)} className={b.status === "maintenance" ? "rowMuted" : undefined}>
                  <td><strong>{String(b.name)}</strong></td>
                  <td><span className={`badge badge-category`}>{String(b.boat_type).replace("_", " ")}</span></td>
                  <td>{String(b.capacity_pax)} pax</td>
                  <td>
                    <span className={`badge badge-trip-${b.status === "active" ? "ready" : b.status === "training" ? "departed" : "cancelled"}`}>
                      {BOAT_STATUS_LABEL[String(b.status)] || String(b.status)}
                    </span>
                  </td>
                  <td className="textMuted">{String(b.notes || "—")}</td>
                  <td>
                    <div className="inlineActions">
                      <button className="actionBtn" disabled={busy} onClick={() => { setEditingBoat(b); setFormOpen(true); }} title="Edit">✎</button>
                      <button className="actionBtn danger" disabled={busy} onClick={() => handleDelete(b)} title="Delete">🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="emptyState">
          <p>No crafts in the fleet yet. Add boats, jet skis, kayaks and SUPs.</p>
        </div>
      )}
      <BoatForm
        key={editingBoat ? String(editingBoat.id) : "new"}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingBoat(undefined); }}
        boat={editingBoat}
        onSaved={(msg) => refresh(msg)}
      />
    </>
  );
}