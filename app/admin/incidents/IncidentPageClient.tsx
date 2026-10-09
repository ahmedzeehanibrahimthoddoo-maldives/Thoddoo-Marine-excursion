"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fmtDate } from "@/lib/format";
import IncidentForm from "./IncidentForm";
import { Toast } from "@/app/admin/components/AdminModal";

interface IncidentPageClientProps {
  initialIncidents: Record<string, unknown>[];
  currentFilter: string;
}

export default function IncidentPageClient({ initialIncidents, currentFilter }: IncidentPageClientProps) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editingIncident, setEditingIncident] = useState<Record<string, unknown> | undefined>(undefined);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  function refresh() {
    router.refresh();
    setFormOpen(false);
    setEditingIncident(undefined);
    setToast({ type: "success", message: editingIncident?.id ? "Incident updated." : "Incident reported." });
    setTimeout(() => setToast(null), 3000);
  }

  const filters = [
    { label: "All", value: "" },
    { label: "Open", value: "false" },
    { label: "Resolved", value: "true" },
  ];

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <div className="pageActions" style={{ marginBottom: 16 }}>
        <button className="addBtn" onClick={() => { setEditingIncident(undefined); setFormOpen(true); }}>
          + Report Incident
        </button>
      </div>
      <div className="filterBar">
        {filters.map((f) => (
          <a
            key={f.value}
            href={f.value ? `/admin/incidents?resolved=${f.value}` : "/admin/incidents"}
            className={`filterBtn ${(currentFilter || "") === f.value ? "active" : ""}`}
          >
            {f.label}
          </a>
        ))}
      </div>
      {initialIncidents.length > 0 ? (
        <div className="tableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Date</th>
                <th>Severity</th>
                <th>Activity</th>
                <th>Customer</th>
                <th>Booking</th>
                <th>Reported By</th>
                <th>Description</th>
                <th>Follow Up</th>
                <th>Resolved</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialIncidents.map((i) => {
                const activities = i.activities as Record<string, unknown> | undefined;
                const customers = i.customers as Record<string, unknown> | undefined;
                const bookings = i.bookings as Record<string, unknown> | undefined;
                return (
                  <tr key={String(i.id)}>
                    <td>{fmtDate(String(i.incident_date))}</td>
                    <td><span className={`badge badge-severity-${i.severity}`}>{String(i.severity)}</span></td>
                    <td>{String(activities?.name || "—")}</td>
                    <td>{String(customers?.full_name || "—")}</td>
                    <td>{String(bookings?.booking_ref || "—")}</td>
                    <td>{String(i.reported_by)}</td>
                    <td className="textTruncate">{String(i.description)}</td>
                    <td>{i.follow_up_needed ? "⚠ Yes" : "—"}</td>
                    <td>{i.resolved ? <span className="badge badge-confirmed">Resolved</span> : <span className="badge badge-pending">Open</span>}</td>
                    <td>
                      <div className="inlineActions">
                        <Link
                          href={`/admin/incidents/${String(i.id)}`}
                          className="actionBtn"
                          title="Full report"
                        >
                          📄
                        </Link>
                        <button
                          className="actionBtn"
                          onClick={() => { setEditingIncident(i); setFormOpen(true); }}
                          title="Edit"
                        >
                          ✎
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="emptyState">
          <p>No incident reports found.</p>
        </div>
      )}
      <IncidentForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingIncident(undefined); }}
        incident={editingIncident}
        onSaved={refresh}
      />
    </>
  );
}
