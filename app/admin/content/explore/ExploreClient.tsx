"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createExploreItem, updateExploreItem, deleteExploreItem } from "@/lib/supabase/actions";
import ExploreForm from "./ExploreForm";
import { Toast } from "@/app/admin/components/AdminModal";

interface Props {
  initialItems: Record<string, unknown>[];
}

export default function ExploreClient({ initialItems }: Props) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | undefined>(undefined);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function flash(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }

  function refresh(msg: string) {
    router.refresh();
    setFormOpen(false);
    setEditing(undefined);
    flash("success", msg);
  }

  async function handleDelete(item: Record<string, unknown>) {
    if (!confirm(`Delete "${String(item.title)}"?`)) return;
    setBusy(true);
    try {
      await deleteExploreItem(String(item.id));
      refresh("Explore item deleted.");
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Failed to delete item");
      setBusy(false);
    }
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <div className="pageActions" style={{ marginBottom: 16 }}>
        <button className="addBtn" onClick={() => { setEditing(undefined); setFormOpen(true); }}>
          + Add Explore Item
        </button>
      </div>
      {initialItems.length > 0 ? (
        <div className="tableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Image</th>
                <th>Title</th>
                <th>Description</th>
                <th>Order</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialItems.map((item) => (
                <tr key={String(item.id)}>
                  <td><img className="tableThumb" src={String(item.image_url)} alt="" /></td>
                  <td><strong>{String(item.title)}</strong></td>
                  <td className="textMuted">{String(item.body || "—")}</td>
                  <td>#{String(item.sort_order)}</td>
                  <td>
                    <span className={`badge ${item.active ? "badge-trip-ready" : "badge-trip-cancelled"}`}>
                      {item.active ? "live" : "hidden"}
                    </span>
                  </td>
                  <td>
                    <div className="inlineActions">
                      <button className="actionBtn" disabled={busy} onClick={() => { setEditing(item); setFormOpen(true); }} title="Edit">✎</button>
                      <button className="actionBtn danger" disabled={busy} onClick={() => handleDelete(item)} title="Delete">🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="emptyState">
          <p>No explore items yet. Add experiences to the public explore page.</p>
        </div>
      )}
      <ExploreForm
        key={editing ? String(editing.id) : "new"}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(undefined); }}
        item={editing}
        onSaved={(msg) => refresh(msg)}
      />
    </>
  );
}