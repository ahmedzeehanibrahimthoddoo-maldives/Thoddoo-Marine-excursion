"use client";

import { useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { createExploreItem, updateExploreItem } from "@/lib/supabase/actions";

interface ExploreFormProps {
  open: boolean;
  onClose: () => void;
  item?: Record<string, unknown>;
  onSaved: (msg: string) => void;
}

export default function ExploreForm({ open, onClose, item, onSaved }: ExploreFormProps) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({
    title: (item?.title as string) || "",
    body: (item?.body as string) || "",
    image_url: (item?.image_url as string) || "",
    sort_order: String(item?.sort_order ?? 0),
    active: (item?.active as boolean) ?? true,
  });

  function set(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setToast({ type: "error", message: "Title is required." });
      return;
    }
    startTransition(async () => {
      try {
        const payload = {
          title: form.title,
          body: form.body,
          image_url: form.image_url,
          sort_order: Number(form.sort_order) || 0,
          active: form.active,
        };
        if (item?.id) {
          await updateExploreItem(String(item.id), payload);
          onSaved("Explore item updated.");
        } else {
          await createExploreItem(payload);
          onSaved("Explore item added.");
        }
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save explore item." });
      }
    });
  }

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={item?.id ? "Edit Explore Item" : "Add Explore Item"}
      wide
      footer={
        <>
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" form="explore-form" className="formSubmit" disabled={pending}>
            {pending ? "Saving..." : item?.id ? "Update Item" : "Add Item"}
          </button>
        </>
      }
    >
      {toast && <Toast type={toast.type} message={toast.message} />}
      <form id="explore-form" onSubmit={handleSubmit}>
        <FormField label="Title" htmlFor="e_title" required>
          <input id="e_title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Sandbank" />
        </FormField>
        <FormField label="Description" htmlFor="e_body">
          <textarea id="e_body" rows={3} value={form.body} onChange={(e) => set("body", e.target.value)} />
        </FormField>
        <FormField label="Image URL" htmlFor="e_image">
          <input id="e_image" value={form.image_url} onChange={(e) => set("image_url", e.target.value)} placeholder="/images/thoddoo/sandbank-trip.jpg" />
        </FormField>
        {form.image_url && (
          <div className="contentPreview">
            <img src={form.image_url} alt="Preview" />
          </div>
        )}
        <FormRow cols={2}>
          <FormField label="Sort order" htmlFor="e_sort" hint="Lower numbers appear first.">
            <input id="e_sort" type="number" value={form.sort_order} onChange={(e) => set("sort_order", e.target.value)} />
          </FormField>
          <FormField label="Visible on page?" htmlFor="e_active">
            <input id="e_active" type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} className="checkboxInput" />
          </FormField>
        </FormRow>
      </form>
    </AdminModal>
  );
}