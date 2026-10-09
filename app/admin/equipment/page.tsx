import { getEquipment } from "@/lib/supabase/actions";
import EquipmentPageClient from "./EquipmentPageClient";

export const metadata = { title: "Equipment | Thoddoo Marine Admin" };

export default async function EquipmentPage() {
  let equipment;
  try {
    equipment = await getEquipment();
  } catch {
    return (
      <div className="adminPage">
        <div className="adminPageHeader"><h1>Equipment</h1></div>
        <div className="errorState">
          <p>Unable to load equipment. Please check your database connection.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Equipment</h1>
        <p className="adminPageSub">{equipment.length} items tracked</p>
      </div>

      <EquipmentPageClient initialEquipment={equipment} />
    </div>
  );
}
