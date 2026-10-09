import { maldivesToday } from "@/lib/operations";
import MyTasksClient from "./MyTasksClient";

export const metadata = { title: "My Tasks | Thoddoo Marine Admin" };

export default async function TasksPage() {
  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>My Tasks</h1>
        <p className="adminPageSub">{maldivesToday()} (Maldives time, UTC+5) — trips, payments and consents needing your attention.</p>
      </div>
      <MyTasksClient />
    </div>
  );
}