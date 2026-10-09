import { getCMSContentSettings } from "@/lib/supabase/actions";
import SettingsClient from "./SettingsClient";

export const metadata = { title: "Site Settings | Thoddoo Marine Admin" };

const MISSING_KEYS = [
  "hero_eyebrow",
  "hero_title_1",
  "hero_title_2",
  "hero_subtitle",
  "phone_1",
  "phone_2",
  "address_line",
  "explore_p1",
  "explore_p2",
  "explore_p3",
  "about_p1",
  "about_p2",
  "about_p3",
];

export const dynamic = "force-dynamic";

export default async function ContentSettingsPage() {
  let settings: Record<string, string> = {};
  try {
    settings = await getCMSContentSettings();
  } catch {
    settings = {};
  }
  for (const k of MISSING_KEYS) {
    if (!settings[k]) settings[k] = "";
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Site Settings</h1>
        <p className="adminPageSub">
          Edit the home hero, contact details and public page copy. Empty fields keep the existing text live.
        </p>
      </div>
      <SettingsClient initial={settings} />
    </div>
  );
}