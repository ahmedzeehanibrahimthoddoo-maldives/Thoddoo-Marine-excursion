"use client";

import { useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { updateActivityContent } from "@/lib/supabase/actions";

interface ActivityContentFormProps {
  open: boolean;
  onClose: () => void;
  item?: Record<string, unknown>;
  onSaved: (msg: string) => void;
}

export default function ActivityContentForm({ open, onClose, item, onSaved }: ActivityContentFormProps) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({
    short_description: (item?.short_description as string) || "",
    image: (item?.image as string) || "",
    hero_image_url: (item?.hero_image_url as string) || "",
    featured: Boolean(item?.featured),
  });

  function set(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!item?.id) return;
    startTransition(async () => {
      try {
        const payload = {
          short_description: form.short_description || null,
          image: form.image || null,
          hero_image_url: form.hero_image_url || null,
          featured: form.featured,
        };
        await updateActivityContent(String(item.id), payload);
        onSaved("Activity page content updated.");
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save activity content." });
      }
    });
  }

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={item ? `Edit: ${String(item.name)}` : "Edit Activity"}
      wide
      footer={
        <>
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" form="ac-form" className="formSubmit" disabled={pending}>
            {pending ? "Saving..." : "Save Content"}
          </button>
        </>
      }
    >
      {toast && <Toast type={toast.type} message={toast.message} />}
      <form id="ac-form" onSubmit={handleSubmit}>
        <FormField label="Short description" htmlFor="ac_short" hint="One-liner shown on activity cards and listings.">
          <textarea id="ac_short" rows={3} value={form.short_description} onChange={(e) => set("short_description", e.target.value)} />
        </FormField>
        <FormField label="Card image URL" htmlFor="ac_image" hint="Thumbnail on cards and listings.">
          <input id="ac_image" value={form.image} onChange={(e) => set("image", e.target.value)} />
        </FormField>
        <FormField label="Hero image URL" htmlFor="ac_hero" hint="Large banner on the activity detail page. Falls back to the card image if empty.">
          <input id="ac_hero" value={form.hero_image_url} onChange={(e) => set("hero_image_url", e.target.value)} />
        </FormField>
        {form.image && <div className="contentPreview"><img src={form.image} alt="Preview" /></div>}
        <FormRow cols={2}>
          <FormField label="Show on homepage popular section?" htmlFor="ac_featured">
            <input id="ac_featured" type="checkbox" checked={form.featured} onChange={(e) => set("featured", e.target.checked)} className="checkboxInput" />
          </FormField>
        </FormRow>
      </form>
    </AdminModal>
  );
}