import { getStaffProfiles, getCurrentUser } from "@/lib/supabase/actions";
import StaffPageClient from "./StaffPageClient";

export const metadata = { title: "Staff | Thoddoo Marine Admin" };

export default async function StaffPage() {
  let staff;
  try {
    staff = await getStaffProfiles();
  } catch {
    return (
      <div className="adminPage">
        <div className="adminPageHeader"><h1>Staff</h1></div>
        <div className="errorState">
          <p>Unable to load staff profiles. Please check your database connection.</p>
        </div>
      </div>
    );
  }

  let currentUserId: string | null = null;
  try {
    const me = await getCurrentUser();
    currentUserId = me?.id ?? null;
  } catch {}

  return (
    <div className="adminPage">
      <StaffPageClient staff={staff} currentUserId={currentUserId} />
    </div>
  );
}
