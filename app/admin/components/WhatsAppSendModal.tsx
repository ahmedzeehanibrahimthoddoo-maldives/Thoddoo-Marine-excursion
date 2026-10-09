"use client";

import { useEffect, useState } from "react";
import AdminModal, { FormField, FormRow } from "./AdminModal";
import {
  WHATSAPP_TEMPLATES,
  buildTemplateMessage,
  buildWhatsAppWebLink,
  type WhatsAppTemplate,
} from "@/lib/whatsapp";

interface WhatsAppSendModalProps {
  open: boolean;
  onClose: () => void;
  phone?: string;
  guestName?: string;
  context?: Omit<Parameters<WhatsAppTemplate["build"]>[0], "guestName">;
  allowedLabels?: string[];
  title?: string;
}

export default function WhatsAppSendModal({
  open,
  onClose,
  phone = "",
  guestName = "",
  context = {},
  allowedLabels,
  title = "Send WhatsApp Message",
}: WhatsAppSendModalProps) {
  const templates = allowedLabels
    ? WHATSAPP_TEMPLATES.filter((t) => allowedLabels.includes(t.label))
    : WHATSAPP_TEMPLATES;
  const [recipient, setRecipient] = useState(phone);
  const [label, setLabel] = useState(templates[0]?.label || "");
  const [message, setMessage] = useState(
    templates[0] ? buildTemplateMessage(templates[0].label, { guestName, ...context }) : ""
  );

  useEffect(() => {
    if (!open) return;
    setRecipient(phone);
    setMessage(templates[0] ? buildTemplateMessage(templates[0].label, { guestName, ...context }) : "");
    setLabel(templates[0]?.label || "");
  }, [open, phone, guestName, context]);

  function pick(label: string) {
    setLabel(label);
    setMessage(buildTemplateMessage(label, { guestName, ...context }));
  }

  const link = buildWhatsAppWebLink(recipient, message);
  const canSend = link.length > 0;

  return (
    <AdminModal open={open} onClose={onClose} title={title} wide>
      <form onSubmit={(e) => { e.preventDefault(); if (canSend) window.open(link, "_blank"); }}>
        <FormRow cols={2}>
          <FormField label="Recipient (phone)" htmlFor="wa_phone" required>
            <input
              id="wa_phone"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="e.g. 960 0000 000"
            />
          </FormField>
          <FormField label="Guest name" htmlFor="wa_name">
            <input id="wa_name" value={guestName} readOnly />
          </FormField>
        </FormRow>

        <FormField label="Template" htmlFor="wa_template">
          <select id="wa_template" value={label} onChange={(e) => pick(e.target.value)}>
            {templates.map((t) => (
              <option key={t.label} value={t.label}>{t.label}</option>
            ))}
          </select>
        </FormField>

        <FormField label="Message" htmlFor="wa_message">
          <textarea
            id="wa_message"
            rows={6}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </FormField>

        <p className="formHint">
          Opens the chat in WhatsApp Web with this message pre-filled. Send and reply from WhatsApp Web to{" "}
          {guestName || "the guest"} — no copy/paste needed.
        </p>

        <div className="formActions">
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="formCancel"
            onClick={() => navigator.clipboard.writeText(message).catch(() => {})}
          >
            Copy message
          </button>
          <button type="submit" className="formSubmit" disabled={!canSend}>
            Open WhatsApp Web
          </button>
        </div>
      </form>
    </AdminModal>
  );
}