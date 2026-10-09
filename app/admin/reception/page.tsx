import { getReceptionBoard } from "@/lib/supabase/actions";
import { maldivesToday } from "@/lib/operations";
import ReceptionBoardClient from "./ReceptionBoardClient";

export const metadata = { title: "Reception | Thoddoo Marine Admin" };
export const dynamic = "force-dynamic";

export default async function ReceptionPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const date = params.date || maldivesToday();

  let rows: unknown[] = [];
  let error = false;
  try {
    rows = await getReceptionBoard(date);
  } catch {
    error = true;
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Reception</h1>
        <p className="adminPageSub">
          Check guests out for their trip and back in when they return.
        </p>
      </div>
      {error ? (
        <div className="errorState">
          <p>Unable to load the departure board. Confirm migrations 038 and 039 have been applied, then refresh.</p>
        </div>
      ) : (
        <ReceptionBoardClient initialRows={rows as never[]} date={date} />
      )}
    </div>
  );
}
