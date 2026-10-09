import { getIncidents } from "@/lib/supabase/actions";
import IncidentPageClient from "./IncidentPageClient";

export const metadata = { title: "Incidents | Thoddoo Marine Admin" };
export const dynamic = "force-dynamic";

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ resolved?: string }>;
}) {
  const params = await searchParams;

  const resolvedParam = params.resolved;
  const resolved =
    resolvedParam === "true" ? true : resolvedParam === "false" ? false : undefined;

  let rows: Record<string, unknown>[] = [];
  try {
    rows = await getIncidents(resolved);
  } catch (err) {
    console.error("Failed to load incidents:", err);
    rows = [];
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Incident Reports</h1>
        <p className="adminPageSub">
          Equipment damage and safety incidents — attached to the responsible booking.
        </p>
      </div>
      <IncidentPageClient initialIncidents={rows} currentFilter={params.resolved || ""} />
    </div>
  );
}