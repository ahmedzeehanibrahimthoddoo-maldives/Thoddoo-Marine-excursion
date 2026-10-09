"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pushExpensesToZoho } from "@/lib/supabase/actions";
import { Toast } from "@/app/admin/components/AdminModal";

export default function PushToZohoButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  function run() {
    if (!window.confirm("Push every expense into the Zoho Sheet as the monthly grid?"))
      return;
    setToast(null);
    startTransition(async () => {
      try {
        const r = await pushExpensesToZoho();
        router.refresh();
        if (!r.ok) throw new Error(r.reason);
        setToast({
          type: "success",
          message:
            (r.created ? "Tab created — " : "") +
            `Sheet updated: ${r.rows} rows, ${r.written} cells written` +
            (r.cleared ? `, ${r.cleared} cleared.` : "."),
        });
      } catch (err) {
        setToast({
          type: "error",
          message: err instanceof Error ? err.message : "Sheet push failed.",
        });
      } finally {
        setTimeout(() => setToast(null), 6000);
      }
    });
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <button
        className="addBtn"
        disabled={pending}
        onClick={run}
        title="Write the expenses into the Zoho Sheet as the monthly grid (App Expenses tab)"
      >
        {pending ? "Pushing…" : "⇪ Push to Zoho"}
      </button>
    </>
  );
}
