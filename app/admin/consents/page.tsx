import { getConsentForms } from "@/lib/supabase/actions";
import ConsentPageClient from "./ConsentPageClient";

export const metadata = { title: "Consent Forms | Thoddoo Marine Admin" };

export default async function ConsentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const status = params.status || "all";

  let forms;
  try {
    forms = await getConsentForms(status);
  } catch {
    return (
      <div className="adminPage">
        <div className="adminPageHeader"><h1>Consent Forms</h1></div>
        <div className="errorState">
          <p>Unable to load consent forms. Please check your database connection.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="adminPage">
      <ConsentPageClient forms={forms} currentStatus={status} />
    </div>
  );
}
