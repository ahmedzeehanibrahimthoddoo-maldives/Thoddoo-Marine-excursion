"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import EquipmentForm from "./EquipmentForm";
import { formatMoney, validCurrency } from "@/lib/money";
import { Toast } from "@/app/admin/components/AdminModal";

interface EquipmentPageClientProps {
  initialEquipment: Record<string, unknown>[];
}

export default function EquipmentPageClient({ initialEquipment }: EquipmentPageClientProps) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<Record<string, unknown> | undefined>(undefined);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  function refresh() {
    router.refresh();
    setFormOpen(false);
    setEditingEquipment(undefined);
    setToast({ type: "success", message: editingEquipment?.id ? "Equipment updated." : "Equipment created." });
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <div className="pageActions" style={{ marginBottom: 16 }}>
        <button className="addBtn" onClick={() => { setEditingEquipment(undefined); setFormOpen(true); }}>
          + Add Equipment
        </button>
      </div>
      {initialEquipment.length > 0 ? (
        <div className="tableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Asset #</th>
                <th>Category</th>
                <th>Condition</th>
                <th>Daily Rate</th>
                <th>Deposit</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialEquipment.map((e) => (
                <tr key={String(e.id)}>
                  <td><strong>{String(e.name)}</strong></td>
                  <td className="mono">{String(e.asset_number)}</td>
                  <td>{String(e.category)}</td>
                  <td><span className={`badge badge-condition-${e.condition_status}`}>{String(e.condition_status)}</span></td>
                  <td>{formatMoney(Number(e.daily_rate_cents), validCurrency(e.currency))}</td>
                  <td>{formatMoney(Number(e.deposit_cents), validCurrency(e.currency))}</td>
                  <td>{e.active ? "✓" : "—"}</td>
                  <td>
                    <div className="inlineActions">
                      <button
                        className="actionBtn"
                        onClick={() => { setEditingEquipment(e); setFormOpen(true); }}
                        title="Edit"
                      >
                        ✎
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
          <p>No equipment items found. Add equipment to start tracking inventory.</p>
        </div>
      )}
      <EquipmentForm
        key={editingEquipment ? String(editingEquipment.id) : "new"}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingEquipment(undefined); }}
        equipment={editingEquipment}
        onSaved={refresh}
      />
    </>
  );
}
