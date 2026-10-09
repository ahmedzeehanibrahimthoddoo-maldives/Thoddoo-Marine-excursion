"use client";

import { useState, useTransition } from "react";
import ActivityForm from "./ActivityForm";
import { deleteActivity } from "@/lib/supabase/actions";
import { formatMoney, validCurrency } from "@/lib/money";

interface ActivityPageClientProps {
  activities: Record<string, unknown>[];
}

export default function ActivityPageClient({ activities }: ActivityPageClientProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Record<string, unknown> | undefined>(undefined);
  const [isPending, startTransition] = useTransition();

  const refresh = () => {
    startTransition(() => {
      window.location.reload();
    });
  };

  const openCreate = () => {
    setEditingActivity(undefined);
    setFormOpen(true);
  };

  const handleDelete = (activity: Record<string, unknown>) => {
    const name = String(activity.name || "this activity");
    if (!window.confirm(`Delete "${name}"? This can't be undone.\n\nNote: activities with existing bookings/trips can't be deleted — deactivate them instead.`)) return;
    startTransition(async () => {
      try {
        await deleteActivity(activity.id as string);
        refresh();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "Failed to delete activity");
      }
    });
  };

  return (
    <>
      <div className="adminPageHeader" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1>Activities</h1>
          <p className="adminPageSub">{activities.length} activities configured</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate} disabled={isPending}>
          + Add Activity
        </button>
      </div>

      {activities.length > 0 ? (
        <div className="tableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Location</th>
                <th>Base Price</th>
                <th>Pricing Options</th>
                <th>GoPro</th>
                <th>Active</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => (
                <tr key={a.id as string}>
                  <td><strong>{a.name as string}</strong></td>
                  <td><span className="badge badge-category">{a.category as string}</span></td>
                  <td>{(a.location as string) || "—"}</td>
                  <td>{formatMoney(Number(a.base_price_cents) || 0, validCurrency(a.currency))}{a.price_note ? ` ${(a.price_note as string)}` : ""}</td>
                  <td>{((a.activity_pricing as unknown[])?.length || 0) as number} options</td>
                  <td>{a.gopro ? "✓" : "—"}</td>
                  <td>
                    {a.active
                      ? <span className="badge badge-confirmed">Active</span>
                      : <span className="badge badge-cancelled">Inactive</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="inlineActions" style={{ justifyContent: "flex-end" }}>
                      <button
                        className="actionBtn"
                        onClick={() => { setEditingActivity(a); setFormOpen(true); }}
                        disabled={isPending}
                        title="Edit activity"
                      >
                        ✎
                      </button>
                      <button
                        className="actionBtn actionBtn-cancelled"
                        onClick={() => handleDelete(a)}
                        disabled={isPending}
                        title="Delete activity"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="emptyState">
          <p>No activities yet. Click "Add Activity" to create one.</p>
        </div>
      )}

      <ActivityForm
        key={editingActivity ? String(editingActivity.id) : "new"}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        activity={editingActivity}
        onSaved={refresh}
      />
    </>
  );
}
