"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CustomerForm from "./CustomerForm";
import WhatsAppSendModal from "@/app/admin/components/WhatsAppSendModal";
import { Toast } from "@/app/admin/components/AdminModal";

interface CustomerPageClientProps {
  initialCustomers: Record<string, unknown>[];
}

export default function CustomerPageClient({ initialCustomers }: CustomerPageClientProps) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Record<string, unknown> | undefined>(undefined);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [waCustomer, setWaCustomer] = useState<Record<string, unknown> | null>(null);

  function refresh() {
    router.refresh();
    setFormOpen(false);
    setEditingCustomer(undefined);
    setToast({ type: "success", message: editingCustomer?.id ? "Customer updated." : "Customer created." });
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <div className="pageActions" style={{ marginBottom: 16 }}>
        <button className="addBtn" onClick={() => { setEditingCustomer(undefined); setFormOpen(true); }}>
          + Add Customer
        </button>
      </div>
      {initialCustomers.length > 0 ? (
        <div className="tableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Hotel</th>
                <th>Room</th>
                <th>Nationality</th>
                <th>Emergency Contact</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialCustomers.map((c) => (
                <tr key={String(c.id)}>
                  <td><strong>{String(c.full_name)}</strong></td>
                  <td>{String(c.phone || "—")}</td>
                  <td>{String(c.hotel || "—")}</td>
                  <td>{String(c.room_number || "—")}</td>
                  <td>{String(c.nationality || "—")}</td>
                  <td>{c.emergency_contact_name ? `${String(c.emergency_contact_name)} (${String(c.emergency_contact_phone || "")})` : "—"}</td>
                  <td>
                    <div className="inlineActions">
                      <button
                        className="actionBtn"
                        onClick={() => setWaCustomer(c)}
                        title="Send WhatsApp message"
                        disabled={!String(c.phone || "").trim()}
                      >
                        💬
                      </button>
                      <button
                        className="actionBtn"
                        onClick={() => { setEditingCustomer(c); setFormOpen(true); }}
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
          <p>No customers found.</p>
        </div>
      )}
      <CustomerForm
        key={editingCustomer ? String(editingCustomer.id) : "new"}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingCustomer(undefined); }}
        customer={editingCustomer}
        onSaved={refresh}
      />
      {waCustomer && (
        <WhatsAppSendModal
          open={true}
          onClose={() => setWaCustomer(null)}
          phone={String(waCustomer.phone || "")}
          guestName={String(waCustomer.full_name || "Guest")}
          context={{
            activity: undefined,
            reference: undefined,
          }}
        />
      )}
    </>
  );
}
