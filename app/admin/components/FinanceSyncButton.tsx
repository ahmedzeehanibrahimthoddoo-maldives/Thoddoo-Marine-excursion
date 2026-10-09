"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncFinanceFromSheetAction } from "@/lib/supabase/actions";
import { Toast } from "@/app/admin/components/AdminModal";

export default function FinanceSyncButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  function run() {
    setToast(null);
    startTransition(async () => {
      try {
        const r = await syncFinanceFromSheetAction();
        router.refresh();
        if (!r.ok) throw new Error(r.reason);
        const exp = r.expenses, inc = r.income;
        setToast({
          type: "success",
          message:
            `Sheet synced — ${exp.inserts + inc.inserts} new, ` +
            `${exp.updates + inc.updates} updated, ${exp.archives + inc.archives} archived.`,
        });
      } catch (err) {
        setToast({
          type: "error",
          message: err instanceof Error ? err.message : "Sheet sync failed.",
        });
      } finally {
        setTimeout(() => setToast(null), 5000);
      }
    });
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <button className="addBtn" disabled={pending} onClick={run} title="Pull the Zoho Sheet ledger into the system">
        {pending ? "Syncing…" : "⇄ Sync Zoho Sheet"}
      </button>
    </>
  );
}