"use client";

export default function ClientPrintButton({ label = "Print / Save PDF" }: { label?: string }) {
  return (
    <button type="button" className="addBtn no-print" onClick={() => window.print()}>
      {label}
    </button>
  );
}