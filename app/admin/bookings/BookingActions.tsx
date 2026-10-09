"use client";

import { useTransition, useState } from "react";
import { updateBookingStatus } from "@/lib/supabase/actions";

export default function BookingActions({
  bookingId,
  currentStatus,
}: {
  bookingId: string;
  currentStatus: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleUpdate(status: string) {
    setError(null);
    startTransition(async () => {
      try {
        await updateBookingStatus(bookingId, status);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update status");
      }
    });
  }

  const nextStatuses: Record<string, string[]> = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["completed", "cancelled", "no_show"],
    completed: [],
    cancelled: [],
    no_show: [],
  };

  const options = nextStatuses[currentStatus] || [];

  if (options.length === 0) return <span className="textMuted">—</span>;

  return (
    <div className="inlineActions">
      {error && (
        <span style={{ fontSize: "0.7rem", color: "#c0392b", marginRight: 4 }} title={error}>!</span>
      )}
      {options.map((s) => (
        <button
          key={s}
          className={`actionBtn actionBtn-${s}`}
          disabled={pending}
          onClick={() => handleUpdate(s)}
        >
          {s === "confirmed" && "✓"}
          {s === "completed" && "●"}
          {s === "cancelled" && "✕"}
          {s === "no_show" && "—"}
        </button>
      ))}
    </div>
  );
}
