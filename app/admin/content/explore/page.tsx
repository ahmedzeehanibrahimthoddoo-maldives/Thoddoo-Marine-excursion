import { getAllExploreItems } from "@/lib/supabase/actions";
import ExploreClient from "./ExploreClient";

export const metadata = { title: "Explore Pages | Thoddoo Marine Admin" };

export const dynamic = "force-dynamic";

export default async function ContentExplorePage() {
  let items: Record<string, unknown>[] = [];
  try {
    items = (await getAllExploreItems()) as unknown as Record<string, unknown>[];
  } catch {
    items = [];
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Explore Pages</h1>
        <p className="adminPageSub">
          Cards in the &quot;Thoddoo Experiences&quot; grid on the landing page.
        </p>
      </div>
      <ExploreClient initialItems={items} />
    </div>
  );
}