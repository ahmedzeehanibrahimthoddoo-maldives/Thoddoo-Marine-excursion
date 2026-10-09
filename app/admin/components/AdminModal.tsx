"use client";

import { useEffect, useRef } from "react";

interface AdminModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export default function AdminModal({ open, onClose, title, wide, footer, children }: AdminModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modalOverlay"
      ref={backdropRef}
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className={`modalCard ${wide ? "modalWide" : ""}`}>
        <div className="modalHeader">
          <h2>{title}</h2>
          <button className="modalClose" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modalBody">{children}</div>
        {footer && <div className="modalFooter">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Shared form primitives ---------- */

export function FormField({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="formField">
      <label htmlFor={htmlFor}>
        {label} {required && <span className="required">*</span>}
      </label>
      {children}
      {hint && <span className="fieldHint">{hint}</span>}
    </div>
  );
}

export function FormRow({
  cols = 2,
  children,
}: {
  cols?: number;
  children: React.ReactNode;
}) {
  return <div className={`formRow formRow-${cols}`}>{children}</div>;
}

export function Toast({ type, message }: { type: "success" | "error"; message: string }) {
  return (
    <div className={`toast toast-${type}`} role="alert">
      {type === "error" ? "⚠" : "✓"} {message}
    </div>
  );
}
