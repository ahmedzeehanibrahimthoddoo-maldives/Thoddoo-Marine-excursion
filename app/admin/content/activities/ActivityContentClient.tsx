"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateActivityContent } from "@/lib/supabase/actions";
import ActivityContentForm from "./ActivityContentForm";
import { Toast } from "@/app/admin/components/AdminModal";

interface Props {
  initialItems: Record<string, unknown>[];
}

export default function ActivityContentClient({ initialItems }: Props) {
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

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      {initialItems.length > 0 ? (
        <div className="tableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Image</th>
                <th>Activity</th>
                <th>Category</th>
                <th>Short description</th>
                <th>Hero image</th>
                <th>Featured</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialItems.map((item) => (
                <tr key={String(item.id)} className={item.active ? undefined : "rowMuted"}>
                  <td><img className="tableThumb" src={String(item.image || "")} alt="" /></td>
                  <td>
                    <strong>{String(item.name)}</strong>
                    <div className="textMuted">{String(item.slug)}</div>
                  </td>
                  <td><span className={`badge badge-category`}>{String(item.category).replace("_", " ")}</span></td>
                  <td className="canDesc">{String(item.short_description || "—")}</td>
                  <td className="textMuted">{item.hero_image_url ? "set" : "—"}</td>
                  <td>{item.featured ? "★" : ""}</td>
                  <td>
                    <span className={`badge ${item.active ? "badge-trip-ready" : "badge-trip-cancelled"}`}>
                      {item.active ? "live" : "hidden"}
                    </span>
                  </td>
                  <td>
                    <div className="inlineActions">
                      <button className="actionBtn" disabled={busy} onClick={() => { setEditing(item); setFormOpen(true); }} title="Edit">✎</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="emptyState">
          <p>No activities found in the database.</p>
        </div>
      )}
      <ActivityContentForm
        key={editing ? String(editing.id) : "none"}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(undefined); }}
        item={editing}
        onSaved={(msg) => refresh(msg)}
      />
    </>
  );
}