import { getBoats } from "@/lib/supabase/actions";
import BoatsPageClient from "./BoatsPageClient";

export const metadata = { title: "Fleet | Thoddoo Marine Admin" };

export default async function BoatsPage() {
  let boats;
  try {
    boats = await getBoats();
  } catch {
    return (
      <div className="adminPage">
        <div className="adminPageHeader"><h1>Fleet</h1></div>
        <div className="errorState">
          <p>Unable to load the fleet. Confirm the 016_operations migration has been applied, then refresh.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Fleet</h1>
        <p className="adminPageSub">{boats.length} crafts — boats, jet skis, kayaks & SUPs. Maintenance blocks trip creation.</p>
      </div>
      <BoatsPageClient initialBoats={boats} />
    </div>
  );
}