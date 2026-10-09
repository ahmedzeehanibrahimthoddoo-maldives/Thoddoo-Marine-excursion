"use client";

import { useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { createGalleryItem, updateGalleryItem } from "@/lib/supabase/actions";

interface GalleryFormProps {
  open: boolean;
  onClose: () => void;
  item?: Record<string, unknown>;
  onSaved: (msg: string) => void;
}

export default function GalleryForm({ open, onClose, item, onSaved }: GalleryFormProps) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({
    image_url: (item?.image_url as string) || "",
    caption: (item?.caption as string) || "",
    orientation: (item?.orientation as string) || "landscape",
    sort_order: String(item?.sort_order ?? 0),
    active: (item?.active as boolean) ?? true,
  });

  function set(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.image_url.trim()) {
      setToast({ type: "error", message: "Image URL is required." });
      return;
    }
    startTransition(async () => {
      try {
        const payload = {
          image_url: form.image_url,
          caption: form.caption,
          orientation: form.orientation,
          sort_order: Number(form.sort_order) || 0,
          active: form.active,
        };
        if (item?.id) {
          await updateGalleryItem(String(item.id), payload);
          onSaved("Gallery image updated.");
        } else {
          await createGalleryItem(payload);
          onSaved("Gallery image added.");
        }
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save gallery image." });
      }
    });
  }

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={item?.id ? "Edit Gallery Image" : "Add Gallery Image"}
      wide
      footer={
        <>
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" form="gallery-form" className="formSubmit" disabled={pending}>
            {pending ? "Saving..." : item?.id ? "Update Image" : "Add Image"}
          </button>
        </>
      }
    >
      {toast && <Toast type={toast.type} message={toast.message} />}
      <form id="gallery-form" onSubmit={handleSubmit}>
        <FormField label="Image URL" htmlFor="g_image" required hint="Local /images/... paths or full external URLs.">
          <input id="g_image" value={form.image_url} onChange={(e) => set("image_url", e.target.value)} placeholder="/images/thoddoo/sandbank-trip.jpg" />
        </FormField>
        {form.image_url && (
          <div className="contentPreview">
            <img src={form.image_url} alt="Preview" />
          </div>
        )}
        <FormRow cols={2}>
          <FormField label="Caption" htmlFor="g_caption">
            <input id="g_caption" value={form.caption} onChange={(e) => set("caption", e.target.value)} />
          </FormField>
          <FormField label="Orientation" htmlFor="g_orientation">
            <select id="g_orientation" value={form.orientation} onChange={(e) => set("orientation", e.target.value)}>
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </FormField>
        </FormRow>
        <FormRow cols={2}>
          <FormField label="Sort order" htmlFor="g_sort" hint="Lower numbers appear first.">
            <input id="g_sort" type="number" value={form.sort_order} onChange={(e) => set("sort_order", e.target.value)} />
          </FormField>
          <FormField label="Visible on gallery?" htmlFor="g_active">
            <input id="g_active" type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} className="checkboxInput" />
          </FormField>
        </FormRow>
      </form>
    </AdminModal>
  );
}