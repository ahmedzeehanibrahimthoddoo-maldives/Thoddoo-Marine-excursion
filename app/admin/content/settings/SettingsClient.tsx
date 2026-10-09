"use client";

import { useState, useTransition } from "react";
import { upsertSiteContent } from "@/lib/supabase/actions";
import { FormField } from "@/app/admin/components/AdminModal";
import { Toast } from "@/app/admin/components/AdminModal";

interface Props {
  initial: Record<string, string>;
}

const SECTIONS: { label: string; hint: string; fields: { key: string; label: string; textarea?: boolean }[] }[] = [
  {
    label: "Home Hero",
    hint: "Shown at the top of the homepage.",
    fields: [
      { key: "hero_eyebrow", label: "Eyebrow line" },
      { key: "hero_title_1", label: "Headline — line 1" },
      { key: "hero_title_2", label: "Headline — line 2 (accent)" },
      { key: "hero_subtitle", label: "Subtitle", textarea: true },
    ],
  },
  {
    label: "Contact Details",
    hint: "Used across the site (find us sections, phone numbers).",
    fields: [
      { key: "phone_1", label: "Phone / WhatsApp 1" },
      { key: "phone_2", label: "Phone / WhatsApp 2" },
      { key: "address_line", label: "Address line" },
    ],
  },
  {
    label: "Explore Thoddoo Page",
    hint: "Intro paragraphs on the landing page.",
    fields: [
      { key: "explore_p1", label: "Paragraph 1", textarea: true },
      { key: "explore_p2", label: "Paragraph 2", textarea: true },
      { key: "explore_p3", label: "Paragraph 3", textarea: true },
    ],
  },
  {
    label: "About Page",
    hint: "Intro paragraphs on the landing page.",
    fields: [
      { key: "about_p1", label: "Paragraph 1", textarea: true },
      { key: "about_p2", label: "Paragraph 2", textarea: true },
      { key: "about_p3", label: "Paragraph 3", textarea: true },
    ],
  },
];

export default function SettingsClient({ initial }: Props) {
  const [form, setForm] = useState<Record<string, string>>(initial);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  function set(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pairs = SECTIONS.flatMap((s) => s.fields).map((f) => ({ key: f.key, value: form[f.key] ?? "" }));
    startTransition(async () => {
      try {
        await upsertSiteContent(pairs);
        setToast({ type: "success", message: "Settings saved and published." });
        setTimeout(() => setToast(null), 3000);
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save." });
      }
    });
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <form onSubmit={handleSubmit} className="contentForm">
        {SECTIONS.map((section) => (
          <div className="adminSection" key={section.label}>
            <h2>{section.label}</h2>
            <p className="adminPageSub">{section.hint}</p>
            <div className="contentFields">
              {section.fields.map((f) => (
                <FormField key={f.key} label={f.label} htmlFor={`c-${f.key}`}>
                  {f.textarea ? (
                    <textarea id={`c-${f.key}`} value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} rows={3} />
                  ) : (
                    <input id={`c-${f.key}`} value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                  )}
                </FormField>
              ))}
            </div>
          </div>
        ))}
        <div className="contentSave">
          <button type="submit" className="formSubmit" disabled={pending}>
            {pending ? "Publishing..." : "Publish Changes"}
          </button>
          <p className="adminPageSub">Changes go live immediately on the public site.</p>
        </div>
      </form>
    </>
  );
}