import { getCrewMembers, getStaffProfiles } from "@/lib/supabase/actions";
import CrewPageClient from "./CrewPageClient";

export const metadata = { title: "Crew | Thoddoo Marine Admin" };

export default async function CrewPage() {
  let crew;
  let staffProfiles = [];
  try {
    const [crewRes, staffRes] = await Promise.all([
      getCrewMembers(),
      getStaffProfiles().catch(() => []),
    ]);
    crew = crewRes;
    staffProfiles = staffRes as { id: string; full_name: string; role: string }[];
  } catch {
    return (
      <div className="adminPage">
        <div className="adminPageHeader"><h1>Crew</h1></div>
        <div className="errorState">
          <p>Unable to load the crew roster. Confirm the 016_operations migration has been applied, then refresh.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Crew Roster</h1>
        <p className="adminPageSub">{crew.length} crew members — guides, captains & operators who run the trips.</p>
      </div>
      <CrewPageClient initialCrew={crew} staffProfiles={staffProfiles} />
    </div>
  );
}