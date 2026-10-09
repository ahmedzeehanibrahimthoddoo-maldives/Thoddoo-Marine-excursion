"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createGalleryItem, updateGalleryItem, deleteGalleryItem } from "@/lib/supabase/actions";
import GalleryForm from "./GalleryForm";
import { Toast } from "@/app/admin/components/AdminModal";

interface Props {
  initialItems: Record<string, unknown>[];
}

export default function GalleryClient({ initialItems }: Props) {
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
    if (!confirm(`Delete this gallery image?`)) return;
    setBusy(true);
    try {
      await deleteGalleryItem(String(item.id));
      refresh("Gallery image deleted.");
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Failed to delete image");
      setBusy(false);
    }
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <div className="pageActions" style={{ marginBottom: 16 }}>
        <button className="addBtn" onClick={() => { setEditing(undefined); setFormOpen(true); }}>
          + Add Gallery Image
        </button>
      </div>
      {initialItems.length > 0 ? (
        <div className="contentCardsGrid">
          {initialItems.map((item) => (
            <div className="contentCard" key={String(item.id)}>
              <img className="contentCardThumb" src={String(item.image_url)} alt={String(item.caption || "Gallery image")} />
              <div className="contentCardBody">
                <strong>{String(item.caption || "—")}</strong>
                <div className="contentCardMeta">
                  <span className={`badge badge-category`}>{String(item.orientation)}</span>
                  <span className="textMuted">#{String(item.sort_order)}</span>
                  <span className={`badge ${item.active ? "badge-trip-ready" : "badge-trip-cancelled"}`}>
                    {item.active ? "live" : "hidden"}
                  </span>
                </div>
                <div className="inlineActions">
                  <button className="actionBtn" disabled={busy} onClick={() => { setEditing(item); setFormOpen(true); }} title="Edit">✎</button>
                  <button className="actionBtn danger" disabled={busy} onClick={() => handleDelete(item)} title="Delete">🗑</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <p>No gallery images yet. Add photos to the public gallery.</p>
        </div>
      )}
      <GalleryForm
        key={editing ? String(editing.id) : "new"}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(undefined); }}
        item={editing}
        onSaved={(msg) => refresh(msg)}
      />
    </>
  );
}