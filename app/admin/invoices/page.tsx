import { createClient } from "@/lib/supabase/server";
import { maldivesToday } from "@/lib/operations";
import { firstOfMonth } from "@/lib/reports";
import { getActivitiesForSelect, getRecentInvoices } from "@/lib/supabase/actions";
import InvoicesClient, { type InvoiceRow } from "./InvoicesClient";

export const metadata = { title: "Invoices | Thoddoo Marine Admin" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clampDate(v: string | null | undefined, fallback: string): string {
  if (v && DATE_RE.test(v)) return v;
  return fallback;
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; partner?: string }>;
}) {
  const params = await searchParams;
  const today = maldivesToday();
  const from = clampDate(params.from, firstOfMonth(today));
  const to = clampDate(params.to, today);

  const supabase = await createClient();
  const { data: roleData } = await supabase.rpc("current_staff_role");
  const role = typeof roleData === "string" ? roleData : null;
  const canFinance = role === "owner" || role === "manager" || role === "reception";

  let partners: string[] = [];
  let activities: { id: string; label: string; sub?: string }[] = [];
  let invoices: InvoiceRow[] = [];
  if (canFinance) {
    const { data } = await supabase
      .from("bookings")
      .select("partner")
      .not("partner", "is", null)
      .neq("partner", "");
    partners = Array.from(
      new Set((data || []).map((b) => String((b as { partner?: string }).partner || "").trim()).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));

    try {
      activities = await getActivitiesForSelect();
    } catch {
      activities = [];
    }
    try {
      invoices = ((await getRecentInvoices(20)) || []) as unknown as InvoiceRow[];
    } catch {
      invoices = [];
    }
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Invoices</h1>
        <p className="adminPageSub">Raise a new invoice, email the PDF, and mark it paid when the money arrives.</p>
      </div>
      {canFinance ? (
        <InvoicesClient
          partners={partners}
          from={from}
          to={to}
          activities={activities}
          invoices={invoices}
        />
      ) : (
        <div className="errorState">
          <p>Access denied: invoices require the owner, manager, or reception role.</p>
        </div>
      )}
    </div>
  );
}